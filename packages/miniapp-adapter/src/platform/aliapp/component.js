// @jgb-ignore
import { defineProperty } from '../../utils/index';
import { createSelectorQuery } from './wxml/createSelectorQuery';
import { createIntersectionObserver } from './wxml/createIntersectionObserver'
import { selectAllComponents, selectComponent } from './base'
import { addComponentToPage, removeComponentToPage } from '../../emulation/pageComponents'
import { emulateExcuteRelations, collectRelations } from '../../emulation/relations'

/**
 * 适配微信小程序Component参数的组件方法
 * @param {*} opts 
 */
export default function AdapterAliappComponent(opts, InjectComponent = Component) {
  // behaviors => mixins
  if (opts.behaviors) {
    opts.mixins = opts.behaviors
    delete opts.behaviors;
  }

  opts = AdapterComponent(opts)

  InjectComponent(opts)
}

export function WrapComponent(InjectComponent = Component) {
  return (opts) => {
    AdapterAliappComponent(opts, InjectComponent)
  }
}

export function AdapterComponent(opts) {
  // 新的生命周期声明方式
  const lifetimes = opts.lifetimes || {};
  // 生命周期函数
  const lifetimeMethods = ['created', 'attached', 'ready', 'moved', 'detached']

  // foreach lifetimes and add highpriority lifetimes
  lifetimeMethods.forEach(key => {
    const fn = opts[key]
    const highLevelFn = lifetimes[key]
    if (typeof highLevelFn === 'function') {
      opts[key] = function (...args) {
        highLevelFn.apply(this, args);
        typeof fn === 'function' && fn.apply(this, args);
      }
    }
  })

  // lifetimes methods
  let { created, attached, ready, moved, detached } = opts;
  const { didUpdate, didUnmount, didMount, onInit, deriveDataFromProps } = opts;

  // remove lifetimes methods
  delete opts.lifetimes;
  lifetimeMethods.forEach(key => {
    delete opts[key]
  })

  /* 存放需要observer的方法 */
  const observers = []

  /** 为自定义组件更新后的回调，每次组件数据变更的时候都会调用。  */
  opts.didUpdate = function (...args) {
    const [prevProps] = args

    didUpdate && didUpdate.call(this, ...args)
    callObserverWhenPropsChange.call(this, prevProps);
  }

  /**
   * 当props改变时，触发observer
   */
  function callObserverWhenPropsChange(prevProps, allowDiffValue = true) {
    const props = this.props || {}
    prevProps = prevProps || {};
    Object.keys(props).forEach(key => {
      const oldVal = prevProps[key]
      const newVal = props[key]
      if (!allowDiffValue || newVal !== oldVal) {
        const o = observers.find(o => o.key === key)
        if (o) {
          o.observer.call(this, newVal, oldVal, [key])
        }
      }
    })
  }

  /** 组件生命周期函数，组件创建时和更新前触发 */
  // opts.deriveDataFromProps = function (...args) {
  //   const [prevProps] = args;
  //   deriveDataFromProps && deriveDataFromProps.call(this, ...args);
  //   callObserverWhenPropsChange.call(this, prevProps, false);
  // }

  // collect relations
  const relations = opts.relations || {}

  /** 为自定义组件被卸载后的回调，每当组件示例从页面卸载的时候都会触发此回调。  */
  opts.didUnmount = function (...args) {
    detached && detached.call(this);

    emulateExcuteRelations(this, 'detached');
    removeComponentToPage(this);

    didUnmount && didUnmount.call(this, ...args);
  }

  /** 1.14开始支持，类似create  */
  opts.onInit = function () {
    addComponentToPage(this);
    extendInstance(this);
    collectRelations(this, relations);

    onInit && onInit.call(this);
    created && created.call(this);
  }

  /** 为自定义组件首次渲染完毕后的回调，此时页面已经渲染，通常在这时请求服务端数据比较合适。  */
  opts.didMount = function (...args) {
    callObserverWhenPropsChange.call(this, this.props, false);
    attached && attached.call(this)
    // 在该节点attached生命周期之后
    emulateExcuteRelations(this, 'attached');
    ready && ready.call(this)

    didMount && didMount.call(this, ...args)
  }

  // properties => props
  if (opts.properties) {
    const props = {}
    Object.keys(opts.properties).forEach(key => {
      let defaultValue = opts.properties[key]
      if (typeof defaultValue === 'function') {
        defaultValue = new defaultValue()
      } else {
        const { type, value, observer } = defaultValue
        defaultValue = value;
        if (observer) {
          observers.push({
            key,
            observer
          })
        }
      }
      props[key] = defaultValue
    })

    opts.props = props

    delete opts.properties;
  } else {
    opts.props = opts.props || {}
  }

  // 收集triggerEvent 并在props中注册
  const fns = getOptionsTriggerEvent(opts);
  if (fns && fns.length) {
    fns.forEach(({ eventName }) => {
      opts.props[eventName] = (data) => console.log(data)
    })
  }

  return opts;
}

const MATCH_BIND_FUNC = /bind([a-zA-Z0-9]+)/
const MATCH_TRIGGEREVENT_PARAMS = /this\.triggerEvent\((.+)\)/g

/**
 * 扩展实例属性
 * @param {*} ctx 
 */
function extendInstance(ctx) {
  // 适配微信小程序属性
  if (!ctx.properties) {
    Object.defineProperty(ctx, 'properties', {
      get() {
        return ctx.props
      }
    })

    defineProperty(ctx, 'createSelectorQuery', () => createSelectorQuery({
      context: ctx
    }))

    defineProperty(ctx, 'createIntersectionObserver', (options) => createIntersectionObserver(ctx, options))

    defineProperty(ctx, 'triggerEvent', triggerEvent)

    Object.defineProperty(ctx, 'id', {
      get() {
        return this.props.id || this.$id
      }
    })

    defineProperty(ctx, 'selectAllComponents', selectAllComponents)

    defineProperty(ctx, 'selectComponent', selectComponent)

    cannotAchieveComponentInstanceFunctions(ctx);
  }
}

function triggerEvent(eventName, data, eventOptions) {
  const name = processEventName(eventName)
  const fn = this.props[name]
  if (typeof fn !== 'function') {
    console.warn(`triggerEvent [${eventName}] is not a function`)
    return
  }
  // 模拟微信triggerEvent
  fn({
    detail: data,
    type: eventName,
    currentTarget: {},
    target: {}
  })
  // fn.call(this, data)
}

/**
 * 获取opts中所有的方法并遍历取出 this.triggerEvent('eventName') 中 eventName
 * @param {*} opts 
 */
function getOptionsTriggerEvent(opts = {}) {
  // 需要trigger的方法
  const fns = []
  const eventNames = new Set()
  eachOptions([opts, opts.methods || {}], (fn) => {
    const fnStr = fn.toString()
    // this.triggerEvent('customevent', {}) => 'customevent', {}
    let matchParams;
    while ((matchParams = MATCH_TRIGGEREVENT_PARAMS.exec(fnStr)) !== null) {
      if (!matchParams) return;
      // 'customevent', {} => ['customevent', {}]
      const params = matchParams[1].split(',')
      let [eventName] = params
      // eventName like 'customevent' so we need remove quotes
      eventName = eventName.replace(/['"]/g, '');
      if (eventNames.has(eventName)) return;
      eventNames.add(eventName)
      fns.push({
        eventName: processEventName(eventName)
      })
    }
  })
  return fns
}

function cannotAchieveComponentInstanceFunctions(ctx) {
  const functionNames = ['hasBehavior', 'getRelationNodes', 'groupSetData']

  functionNames.forEach(name => {
    const method = createNotAchievedMethod(name)
    defineProperty(ctx, name, method)
  })
}

function createNotAchievedMethod(name) {
  return () => {
    console.warn('can not achieve method: ' + name)
  }
}

function eachOptions(opts, callback) {
  [].concat(opts).forEach((opt) => {
    const keys = Object.keys(opt)
    keys.forEach(key => {
      const fn = opt[key]
      if (typeof fn !== 'function') return;
      callback(fn)
    })
  })
}

/**
 * > 触发事件 this.triggerEvent('myevent')
 * > 支付宝：外部使用自定义组件时，如果传递的参数是函数，一定要要以 on 为前缀，否则会将其处理为字符串。
 * @param {*} eventName 
 */
function processEventName(eventName = '') {
  // tap => onTap
  eventName = `${eventName}`
  return `on${eventName[0].toUpperCase()}${eventName.slice(1)}`
}
