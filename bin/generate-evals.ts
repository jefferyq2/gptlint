#!/usr/bin/env node
import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { Msg } from '@dexaai/dexter'
import { gracefulExit } from 'exit-hook'
import hashObject from 'hash-object'
import pMap from 'p-map'

import type * as types from '../src/types.js'
import { createChatModel } from '../src/create-chat-model.js'
import { formatSource } from '../src/formatter.js'
import {
  findAllCodeBlockNodes,
  parseMarkdownAST
} from '../src/markdown-utils.js'
import { resolveLinterCLIConfig } from '../src/resolve-cli-config.js'
import { resolveRules } from '../src/resolve-rules.js'
import { stringifyRuleForModel } from '../src/rule-utils.js'
import {
  inferBestPossibleCodeFileExtension,
  logDebugConfig,
  omit
} from '../src/utils.js'

/**
 * Internal CLI to generate synthetic eval data (code snippets) for rules.
 */
async function main() {
  const cwd = process.cwd()

  const { args, linterConfig: config } = await resolveLinterCLIConfig(
    process.argv,
    {
      name: 'generate-evals',
      cwd,
      linterConfigDefaults: {
        llmOptions: {
          // Use GPT-4 as the default for evals
          model: 'gpt-4-turbo-preview'
        }
      },
      flagsToAdd: {
        numExamples: {
          type: Number,
          description:
            'Number of examples to generate per rule category (correct / incorrect).',
          alias: 'n',
          default: 15
        },
        onlyPositive: {
          type: Boolean,
          description: 'Only generate positive examples',
          default: false
        },
        onlyNegative: {
          type: Boolean,
          description: 'Only generate negative examples',
          default: false
        }
      }
    }
  )

  const onlyPositive = !!(args.flags as any).onlyPositive
  const onlyNegative = !!(args.flags as any).onlyNegative

  if (onlyPositive && onlyNegative) {
    console.error('Cannot specify both --only-positive and --only-negative')
    args.showHelp()
    return gracefulExit(1)
  }

  let rules: types.Rule[]

  try {
    rules = await resolveRules({ cwd, config })
  } catch (err: any) {
    console.error('Error:', err.message, '\n')
    console.error(err.stack)
    args.showHelp()
    return gracefulExit(1)
  }

  // TODO: support non-file rules
  rules = rules.filter(
    (rule) => rule.scope === 'file' && rule.description?.trim()
  )

  if (config.linterOptions.printConfig) {
    logDebugConfig({ rules, config })
    return gracefulExit(0)
  }

  if (!rules.length) {
    console.error('No rules enabled; run with --print-config to debug\n')
    return gracefulExit(1)
  }

  const chatModel = createChatModel(config)

  const numExamples: number = (args.flags as any).numExamples
  const outputDir = path.join('fixtures', 'evals')
  await fs.mkdir(outputDir, { recursive: true })

  const llmStats = {
    totalCost: 0,
    numPromptTokens: 0,
    numCompletionTokens: 0,
    numTotalTokens: 0
  }

  await pMap(
    rules,
    async function generateEvalsForRule(rule) {
      const ruleExamplesDir = path.join(outputDir, rule.name)
      console.log(`\nprocessing rule ${rule.name} ⇒ ${ruleExamplesDir}`)
      await fs.mkdir(ruleExamplesDir, { recursive: true })

      if (!onlyNegative) {
        // Positive examples
        const positiveRuleExamplesDir = path.join(ruleExamplesDir, 'correct')
        await fs.mkdir(positiveRuleExamplesDir, { recursive: true })

        console.log(`\n${rule.name} generating ${numExamples} correct examples`)

        const res = await chatModel.run({
          messages: [
            Msg.system(
              `You are an expert senior TypeScript software engineer at Vercel who loves to lint code.

${stringifyRuleForModel(rule)}
`
            ),

            Msg.user(
              `Generate ${numExamples} **diverse** code snippets which CORRECTLY adhere to the given RULE. Separate each code snippet within markdown code blocks. Include brief comments inside each code snippet which explain why the code CORRECTLY adheres to the given RULE. Do not include any prose or descriptions outside of the code blocks.

Remember to make the code snippets **diverse** both in terms of different ways of CORRECTLY adhering to the given RULE, as well as in terms of the code itself. If the RULE gives covers multiple scenarios, make sure to include examples that cover each scenario individually.`
            )
          ]
        })

        console.log(`\n${rule.name} correct examples:\n`, res.message.content)

        const ast = parseMarkdownAST(res.message.content!)
        const codeBlocks = findAllCodeBlockNodes(ast)

        for (const codeBlock of codeBlocks) {
          const fileType = inferBestPossibleCodeFileExtension(codeBlock.lang, {
            fallbacks: rule.languages
          })
          let content = codeBlock.value.trim()
          if (!content) continue
          try {
            const commentToken = fileType === 'py' ? '#' : '//'
            content = `${content}\n\n${commentToken} Generated by ${res.model}`
            content = await formatSource(content, { fileType })
          } catch {}
          const fileHash = hashObject(
            { fileType, content },
            { algorithm: 'sha256' }
          ).slice(0, 8)
          const fileName = `${fileHash}.${fileType}`
          const filePath = path.join(positiveRuleExamplesDir, fileName)
          await fs.writeFile(filePath, content, { encoding: 'utf8' })
        }

        if (res.cost) {
          llmStats.totalCost += res.cost
        } else if ((res.usage as any)?.total_cost) {
          llmStats.totalCost += 100 * (res.usage as any).total_cost
        }

        if (res.usage) {
          llmStats.numPromptTokens += res.usage.prompt_tokens
          llmStats.numCompletionTokens += res.usage.completion_tokens
          llmStats.numTotalTokens += res.usage.total_tokens
        }
      }

      if (!onlyPositive) {
        // Negative examples
        const negativeRuleExamplesDir = path.join(ruleExamplesDir, 'incorrect')
        await fs.mkdir(negativeRuleExamplesDir, { recursive: true })

        console.log(
          `\n${rule.name} generating ${numExamples} incorrect examples`
        )

        const res = await chatModel.run({
          messages: [
            Msg.system(
              `You are an expert senior TypeScript software engineer at Vercel who loves to lint code.

${stringifyRuleForModel(rule)}
`
            ),

            Msg.user(
              `Generate ${numExamples} diverse code snippets which VIOLATE the given RULE. Separate each code snippet within markdown code blocks. Include brief comments inside each code snippet which explain why the code VIOLATES to the given RULE. Do not include any prose or descriptions outside of the code blocks. Remember to make the code snippets diverse both in terms of different ways of VIOLATING the given RULE, as well as in terms of the code itself.

Remember to make the code snippets **diverse** both in terms of different ways of VIOLATING the given RULE, as well as in terms of the code itself. If the RULE gives covers multiple scenarios, make sure to include examples that cover each scenario individually.`
            )
          ]
        })

        console.log(`\n${rule.name} incorrect examples:\n`, res.message.content)

        const ast = parseMarkdownAST(res.message.content!)
        const codeBlocks = findAllCodeBlockNodes(ast)

        for (const codeBlock of codeBlocks) {
          const fileType = inferBestPossibleCodeFileExtension(codeBlock.lang, {
            fallbacks: rule.languages
          })
          let content = codeBlock.value.trim()
          if (!content) continue
          try {
            const commentToken = fileType === 'py' ? '#' : '//'
            content = `${content}\n\n${commentToken} Generated by ${res.model}`
            content = await formatSource(content, { fileType })
          } catch {}
          const fileHash = hashObject(
            { fileType, content },
            { algorithm: 'sha256' }
          ).slice(0, 8)
          const fileName = [fileHash, fileType].filter(Boolean).join('.')
          const filePath = path.join(negativeRuleExamplesDir, fileName)
          await fs.writeFile(filePath, content, { encoding: 'utf8' })
        }

        if (res.cost) {
          llmStats.totalCost += res.cost
        } else if ((res.usage as any)?.total_cost) {
          llmStats.totalCost += 100 * (res.usage as any).total_cost
        }

        if (res.usage) {
          llmStats.numPromptTokens += res.usage.prompt_tokens
          llmStats.numCompletionTokens += res.usage.completion_tokens
          llmStats.numTotalTokens += res.usage.total_tokens
        }
      }
    },
    {
      concurrency: 8
    }
  )

  if (config.linterOptions.debugStats) {
    console.log(
      `\nLLM stats; total cost $${(llmStats.totalCost / 100).toFixed(2)}`,
      {
        model: config.llmOptions.model,
        ...omit(llmStats, 'totalCost')
      }
    )
  }
}

try {
  await main()
} catch (err) {
  console.error(err)
  gracefulExit(1)
}
