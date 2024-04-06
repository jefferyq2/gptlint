// Example 5: Document edit history
interface EditHistory {
  past: string[]
  present: string
  future: string[]
}

// By structuring the edit history this way, we ensure that the current state is always valid and can be derived from past and future edits.

// Generated by gpt-4-0125-preview
