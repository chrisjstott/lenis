import Tempus from '@darkroom.engineering/tempus'
import Lenis, { type ScrollCallback } from 'lenis'
import type { HTMLAttributes, InjectionKey, Plugin, PropType } from 'vue'
import {
  defineComponent,
  getCurrentInstance,
  h,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'

export const LenisSymbol: InjectionKey<null> = Symbol('LenisContext')

export const VueLenis = defineComponent({
  name: 'VueLenis',
  props: {
    root: {
      type: Boolean as PropType<boolean>,
      default: false,
    },
    autoRaf: {
      type: Boolean as PropType<boolean>,
      default: true,
    },
    rafPriority: {
      type: Number as PropType<number>,
      default: 0,
    },
    options: {
      type: Object as PropType<ConstructorParameters<typeof Lenis>[0]>,
      default: () => ({}),
    },
    props: {
      type: Object as PropType<HTMLAttributes>,
      default: () => ({}),
    },
  },
  setup(props, { slots }) {
    const lenisRef = shallowRef<Lenis | null>(null)
    const tempusCleanupRef = shallowRef<() => void>()
    const wrapper = ref<HTMLDivElement>()
    const content = ref<HTMLDivElement>()

    onMounted(() => {
      lenisRef.value = new Lenis({
        ...props.options,
        ...(!props.root
          ? {
              wrapper: wrapper.value,
              content: content.value,
            }
          : {}),
      })
    })

    onBeforeUnmount(() => {
      lenisRef.value?.destroy()
      lenisRef.value = null
    })

    // Sync options
    watch(props, (props, oldProps) => {
      const rootChanged = oldProps.root !== props.root
      const optionsChanged =
        JSON.stringify(oldProps.options) !== JSON.stringify(props.options)

      if (rootChanged || optionsChanged) {
        lenisRef.value?.destroy()
        lenisRef.value = new Lenis({
          ...props.options,
          ...(!props.root
            ? {
                wrapper: wrapper.value,
                content: content.value,
              }
            : {}),
        })
      }
    })

    // Sync autoRaf
    watch([lenisRef, props], ([lenis, props], [oldLenis, oldProps]) => {
      if ((props.autoRaf === oldProps.autoRaf && lenis === oldLenis) || !lenis)
        return
      tempusCleanupRef.value?.()
      tempusCleanupRef.value = Tempus.add((time: number) => lenis?.raf(time))
    })

    const callbacks = reactive<
      { callback: ScrollCallback; priority: number }[]
    >([])

    function addCallback(callback: ScrollCallback, priority: number) {
      callbacks.push({ callback, priority })
      callbacks.sort((a, b) => a.priority - b.priority)
    }

    function removeCallback(callback: ScrollCallback) {
      callbacks.splice(
        callbacks.findIndex((cb) => cb.callback === callback),
        1
      )
    }

    const onScroll: ScrollCallback = (data) => {
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i]?.callback(data)
      }
    }

    watch(lenisRef, (lenis) => {
      lenis?.off('scroll', onScroll)
      lenis?.on('scroll', onScroll)
    })

    const context = reactive({
      lenis: lenisRef.value,
      addCallback,
      removeCallback,
    })

    watch(lenisRef, (lenis) => {
      context.lenis = lenis
    })

    if (props.root) {
      // Provide a null value to not get the empty injection warning
      provide(LenisSymbol, null)
    } else {
      provide(LenisSymbol, context as any)
    }

    // Sync global lenis instance
    const app = getCurrentInstance()
    watch(
      () => context,
      (context) => {
        if (props.root) {
          if (!app) throw new Error('No app found')
          app.appContext.config.globalProperties.$lenisContext.lenis =
            context.lenis
          app.appContext.config.globalProperties.$lenisContext.addCallback =
            context.addCallback
          app.appContext.config.globalProperties.$lenisContext.removeCallback =
            context.removeCallback
        }
      },
      { deep: true }
    )

    return () => {
      if (props.root) {
        return slots.default?.()
      } else {
        const combinedClassName = ['lenis', props.props?.class]
          .filter(Boolean)
          .join(' ')
        delete props.props?.class

        return h('div', { class: combinedClassName, ref: wrapper, ...props }, [
          h('div', { ref: content }, slots.default?.()),
        ])
      }
    }
  },
})

export const vueLenisPlugin: Plugin = (app) => {
  app.component('lenis', VueLenis)
  // Setup a global provide to silence top level useLenis injection warning
  app.provide(LenisSymbol, null)
  app.config.globalProperties.$lenisContext = reactive({
    lenis: null,
    addCallback: () => {},
    removeCallback: () => {},
  })
}