async function logActivity() {
  // Log some activity
}

// Violation: The Promise from logActivity is not handled when called in a loop.
;[1, 2, 3].forEach(async (item) => {
  logActivity()
})

// Generated by gpt-4-0125-preview
