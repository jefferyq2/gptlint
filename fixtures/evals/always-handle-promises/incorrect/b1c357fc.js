async function updateDatabase() {
  // Update some records in the database
}

// Violation: Ignoring the Promise returned by updateDatabase inside an event listener.
document.getElementById('updateButton').addEventListener('click', () => {
  updateDatabase()
})

// Generated by gpt-4-0125-preview
