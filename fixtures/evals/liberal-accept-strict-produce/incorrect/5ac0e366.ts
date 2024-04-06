// Example 6: Function with optional return properties
function fetchData(): { data?: object; error?: object } {
  return { data: { message: 'Hello' } }
  // VIOLATION: The function returns a type with optional properties, which is not strict.
}

// Generated by gpt-4-0125-preview