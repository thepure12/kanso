export default defineAppConfig({
  ui: {
    colors: { primary: 'indigo', neutral: 'zinc' },
    // Long tooltips (card titles, name lists) wrap instead of being cut off.
    tooltip: {
      slots: {
        content: 'h-auto min-h-6 max-w-80',
        text: 'whitespace-normal! break-words',
      },
    },
  },
})
