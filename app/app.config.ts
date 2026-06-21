export default defineAppConfig({
  ui: {
    colors: {
      primary: 'purple',
      neutral: 'slate'
    },
    popover: {
      slots: {
        content: 'z-[320]'
      }
    },
    select: {
      slots: {
        content: 'z-[320]'
      }
    },
    selectMenu: {
      slots: {
        content: 'z-[320]'
      }
    },
    inputMenu: {
      slots: {
        content: 'z-[320]'
      }
    },
    modal: {
      slots: {
        content: 'max-h-[90vh] flex flex-col',
        body: 'overflow-y-auto'
      }
    },
    dashboardPanel: {
      slots: {
        body: 'pb-[60px] mb-[60px] sm:mb-0 xl:mb-0 sm:pb-0 xl:pb-0'
      }
    }
  }
})
