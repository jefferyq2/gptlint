// Example 4: Function returns an overly broad type
function getSettings(): any {
  return { theme: 'dark' }
  // VIOLATION: The function returns 'any', which is too broad and not strict.
}

// Generated by gpt-4-0125-preview