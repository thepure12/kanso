import { defineComponent } from 'vue'
import { config } from '@vue/test-utils'

// Components mount without UApp, so there is no TooltipProvider: render tooltips as their trigger only.
config.global.stubs = {
  ...config.global.stubs,
  UTooltip: defineComponent((_, { slots }) => () => slots.default?.()),
}
