/**
 * WatcherClass provides an abstract implementation of a watcher to the LiveSelector
 *
 * You should extend it and implement your own watch logic.
 *
 * Built-in watcher:
 *
 * - Mutation Observer watcher (based on MutationObserver api, watch DOM changes)
 * - Interval watcher (based on time interval)
 * - Event watcher (based on addEventListener)
 */
import { DomProxy, DomProxyOptions } from './Proxy'
import { EventEmitter } from 'events'
import { LiveSelector } from './LiveSelector'

import differenceWith from 'lodash-es/differenceWith'
import intersectionWith from 'lodash-es/intersectionWith'
import uniqWith from 'lodash-es/uniqWith'
/** interface for `requestIdleCallback` */
interface Deadline {
    didTimeout: boolean
    timeRemaining(): number
}
/** Callback on Remove */
type RemoveCallback<T> = (oldNode: T) => void
/** Callback on target changed */
type TargetChangedCallback<T> = (oldNode: T, newNode: T) => void
/** Callback on  */
type MutationCallback<T> = (node: T, mutations: MutationRecord[]) => void
/**
 * Return value of useForeach
 */
type useForeachReturns<T> =
    | void
    | RemoveCallback<T>
    | {
          onRemove?: RemoveCallback<T>
          onTargetChanged?: TargetChangedCallback<T>
          /** Will not called if T is not Element */
          onNodeMutation?: MutationCallback<T>
      }

type useForeachFnWithElement<T, Before extends Element, After extends Element> = {
    (virtualNode: DomProxy<T & Element, Before, After>, key: unknown, realNode: Element): useForeachReturns<T>
}
type useForeachFnWithoutElement<T> = {
    (node: T): useForeachReturns<T>
}
interface useForeachFn<T, Before extends Element, After extends Element> {
    (
        ...args: T extends Element
            ? Parameters<useForeachFnWithElement<T, Before, After>>
            : Parameters<useForeachFnWithoutElement<T>>
    ): useForeachReturns<T>
}

function applyUseForeachCallback<T>(callback: useForeachReturns<T>) {
    const cb = callback as useForeachReturns<Element>
    let remove: any, change: any, mutation: any
    if (cb === undefined) {
    } else if (typeof cb === 'function') remove = cb
    else if (cb) {
        const { onNodeMutation, onRemove, onTargetChanged } = cb
        ;[remove, change, mutation] = [onRemove, onTargetChanged, onNodeMutation]
    }
    // Return
    interface applyUseForeach {
        (type: 'remove'): RemoveCallback<T>
        (type: 'target change'): TargetChangedCallback<T>
        (type: 'mutation'): MutationCallback<T>
    }
    return ((type: string) => (...args: any[]) => {
        if (type === 'remove') remove && remove(...args)
        else if (type === 'target change') change && change(...args)
        else if (type === 'mutation') mutation && mutation(...args)
    }) as applyUseForeach
}
type EventCallback<T> = (fn: Event & { data: T }) => void
type ResultOf<SingleMode extends boolean, Result> = SingleMode extends true ? (Result) : (Result)[]
function defaultEqualityComparer(a: unknown, b: unknown) {
    return a === b
}
function defaultMapNodeToKey(node: unknown) {
    return node
}
function isWatcherWithElement<T>(
    watcher: Watcher<T, any, any, any>,
    node: T,
): watcher is typeof watcher extends Watcher<infer U, infer P, infer Q, infer R>
    ? Watcher<U & Element, P, Q, R>
    : never {
    return node instanceof Element
}

/**
 * Use LiveSelector to watch dom change
 *
 * You need to implement `startWatch`
 */
export abstract class Watcher<
    T,
    Before extends Element,
    After extends Element,
    /** Is the watcher running in single mode? This will improve performance. */
    SingleMode extends boolean
> {
    /** Event emitter */
    protected readonly eventEmitter = new EventEmitter()
    protected readonly stack = new Error().stack
    constructor(protected liveSelector: LiveSelector<T, SingleMode>) {
        if ('requestIdleCallback' in window) {
            this.requestIdleCallback = (...args: any) => (window as any)['requestIdleCallback'](...args)
        }
    }
    //#region DomProxy options
    protected domProxyOption: Partial<DomProxyOptions<Before, After>> = {}
    /**
     * Set option for DomProxy
     * @param option - DomProxy options
     */
    setDomProxyOption(option: Partial<DomProxyOptions<Before, After>>): this {
        this.domProxyOption = option
        const oldProxy = this._firstVirtualNode
        if (
            oldProxy.has('after') ||
            oldProxy.has('before') ||
            oldProxy.has('afterShadow') ||
            oldProxy.has('beforeShadow') ||
            oldProxy.realCurrent
        ) {
            console.warn("Don't set DomProxy before using it.")
        }
        this._firstVirtualNode = DomProxy(option)
        return this
    }
    //#endregion
    //#region Watch once
    /**
     * Run the Watcher once. Once it emit data, stop watching.
     * @param map - Map function transform T to Result
     * @param options - Options for watcher
     * @param starter - How to start the watcher
     */
    once(): Promise<ResultOf<SingleMode, T>>
    once<Result>(map: (data: T) => PromiseLike<Result> | Result): Promise<ResultOf<SingleMode, Result>>
    once<Result>(
        map: (data: T) => PromiseLike<Result> | Result = data => (data as any) as Result,
        options: Partial<{
            minimalResultsRequired: number
        }> = {},
        starter: (this: this, self: this) => void = watcher => watcher.startWatch(),
    ): Promise<ResultOf<SingleMode, Result>> {
        const { minimalResultsRequired } = {
            ...({
                minimalResultsRequired: 1,
            } as Required<typeof options>),
            ...options,
        }
        if (minimalResultsRequired < 1)
            throw new TypeError('Invalid minimalResultsRequired, must equal to or bigger than 1')
        if (this.singleMode && minimalResultsRequired > 1) {
            console.warn('[@holoflows/kit] In single mode, the watcher will ignore the option minimalResultsRequired')
        }
        const result = this.liveSelector.evaluateOnce()
        // If in single mode, return the value now
        if (this.singleMode) {
            const returns = map(result as T)
            return Promise.resolve(returns as any)
        } else if ((result as T[]).length >= minimalResultsRequired) {
            const returns = (result as T[]).map(map)
            return Promise.all(returns) as Promise<any>
        }
        // Or return a promise to wait the value
        return new Promise<ResultOf<SingleMode, Result>>((resolve, reject) => {
            starter.bind(this)(this)
            const f: EventCallback<OnIterationEvent<T>> = e => {
                const nodes = e.data.values.current
                if (this.singleMode && nodes.length >= 1) {
                    const returns = map(nodes[0])
                    resolve(returns as any)
                }
                if (nodes.length < minimalResultsRequired) return
                this.stopWatch()
                Promise.all(nodes.map(map)).then(resolve as any, reject)
                this.removeListener('onIteration', f)
            }
            this.addListener('onIteration', f)
        })
    }
    //#endregion
    abstract startWatch(...args: any[]): this
    protected notifyDeveloperCallStartWatch = (stack => () => {
        if (process.env.NODE_ENV === 'development') {
            setTimeout(
                () =>
                    !this.calledStartWatch &&
                    console.warn('[@holoflows/kit] Did you forget to call `.startWatch()`?\n', stack),
                5000,
            )
        }
    })(new Error().stack)
    stopWatch(...args: any[]): void {
        this.watching = false
    }
    //#region Watcher
    /** Is the watcher running */
    protected requestIdleCallback(fn: (t: Deadline) => void, timeout?: { timeout: number }) {
        const start = Date.now()
        return setTimeout(() => {
            fn({
                didTimeout: false,
                timeRemaining: function() {
                    return Math.max(0, 50 - (Date.now() - start))
                },
            })
        }, 1)
    }
    protected _watching = false
    /** Has developer called startWatch() even once? */
    protected calledStartWatch = false
    /** If the watcher is watching */
    protected get watching() {
        return this._watching
    }
    protected set watching(val) {
        this._watching = true
        this.calledStartWatch = true
    }
    /** Found key list of last watch */
    protected lastKeyList: readonly unknown[] = []
    /** Found Node list of last watch */
    protected lastNodeList: readonly T[] = []
    /** Saved callback map of last watch */
    protected lastCallbackMap = new Map<unknown, useForeachReturns<T>>()
    /** Saved virtual node of last watch */
    protected lastVirtualNodesMap = new Map<unknown, DomProxy<any, Before, After>>()
    /** Last iteration value for single mode */
    protected singleModeLastValue?: T
    /** Does it has a last iteration value in single mode? */
    protected singleModeHasLastValue = false
    /** Callback for single mode */
    protected singleModeCallback?: useForeachReturns<T>
    /** Find node from the given list by key */
    protected findNodeFromListByKey = (list: readonly T[], keys: readonly unknown[]) => (key: unknown) => {
        const i = keys.findIndex(x => this.keyComparer(x, key))
        if (i === -1) return null
        return list[i]
    }
    protected _omitWarningForRepeatedKeys = false
    /**
     * If you're expecting repeating keys, call this function, this will omit the warning.
     */
    omitWarningForRepeatedKeys() {
        this.noNeedInSingleMode(this.omitWarningForRepeatedKeys.name)
        this._omitWarningForRepeatedKeys = true
        return this
    }
    protected singleModeWatcherCallback(firstValue: T) {
        // Simple version of watcherCallback. Improve performance.
        if (firstValue instanceof Element) {
            this.firstVirtualNode.realCurrent = firstValue
        }
        // ? Case: value is gone
        if (this.singleModeHasLastValue && !firstValue) {
            applyUseForeachCallback(this.singleModeCallback)('remove')(this.singleModeLastValue!)
            if (this.singleModeLastValue instanceof Element) {
                this._firstVirtualNode.realCurrent = null
            }
            this.emit('onRemove', { key: undefined, value: this.singleModeLastValue! })
            this.singleModeLastValue = undefined
            this.singleModeHasLastValue = false
        }
        // ? Case: value is new
        else if (!this.singleModeHasLastValue && firstValue) {
            if (isWatcherWithElement(this, firstValue)) {
                const val = firstValue as T & Element
                if (this.useForeachFn) {
                    this.singleModeCallback = (this.useForeachFn as useForeachFnWithElement<T, Before, After>)(
                        this.firstVirtualNode,
                        val,
                        val,
                    )
                }
            } else {
                if (this.useForeachFn) {
                    this.singleModeCallback = (this.useForeachFn as useForeachFnWithoutElement<T>)(firstValue)
                }
            }
            this.emit('onAdd', { key: undefined, value: firstValue })
            this.singleModeLastValue = firstValue
            this.singleModeHasLastValue = true
        }
        // ? Case: value has changed
        else if (this.singleModeHasLastValue && !this.valueComparer(this.singleModeLastValue!, firstValue)) {
            applyUseForeachCallback(this.singleModeCallback)('target change')(this.singleModeLastValue!, firstValue)
            this.emit('onChange', {
                newKey: undefined,
                oldKey: undefined,
                newValue: firstValue,
                oldValue: this.singleModeLastValue,
            } as OnChangeEvent<T>)
            this.singleModeLastValue = firstValue
            this.singleModeHasLastValue = true
        }
        // ? Case: value is not changed
        else {
            // ? Do nothing
        }
        return
    }
    protected normalModeWatcherCallback(currentIteration: readonly T[]) {
        /** Key list in this iteration */
        const thisKeyList: readonly unknown[] =
            this.mapNodeToKey === defaultMapNodeToKey ? currentIteration : currentIteration.map(this.mapNodeToKey)

        //#region Warn about repeated keys
        {
            if (!this._omitWarningForRepeatedKeys) {
                const uniq = uniqWith(thisKeyList, this.keyComparer)
                if (uniq.length < thisKeyList.length) {
                    console.warn(
                        'There are repeated keys in your watcher. [uniqKeys, allKeys] = ',
                        uniq,
                        thisKeyList,
                        ', to omit this warning, call watcher.omitWarningForRepeatedKeys',
                    )
                }
            }
        }
        //#endregion

        // New maps for the next generation
        /** Next generation Callback map */
        const nextCallbackMap = new Map<unknown, useForeachReturns<T>>()
        /** Next generation VirtualNode map */
        const nextVirtualNodesMap = new Map<unknown, DomProxy<any, Before, After>>()

        //#region Key is gone
        // Do: Delete node
        const findFromLast = this.findNodeFromListByKey(this.lastNodeList, this.lastKeyList)
        const goneKeys = differenceWith(this.lastKeyList, thisKeyList, this.keyComparer)
        {
            for (const oldKey of goneKeys) {
                const virtualNode = this.lastVirtualNodesMap.get(oldKey)
                const callbacks = this.lastCallbackMap.get(oldKey)
                const node = findFromLast(oldKey)!
                this.requestIdleCallback(
                    () => {
                        applyUseForeachCallback(callbacks)('remove')(node)
                        if (virtualNode) virtualNode.destroy()
                    },
                    // Delete node don't need a short timeout.
                    { timeout: 2000 },
                )
            }
        }
        //#endregion

        //#region Key is new
        // Do: Add node
        const findFromNew = this.findNodeFromListByKey(currentIteration, thisKeyList)
        const newKeys = differenceWith(thisKeyList, this.lastKeyList, this.keyComparer)
        {
            for (const newKey of newKeys) {
                if (!this.useForeachFn) break
                const node = findFromNew(newKey)
                if (node instanceof Element) {
                    const virtualNode = DomProxy<typeof node, Before, After>(this.domProxyOption)
                    virtualNode.realCurrent = node
                    // This step must be sync.
                    const callbacks = (this.useForeachFn as useForeachFnWithElement<T, Before, After>)(
                        virtualNode,
                        newKey,
                        node,
                    )
                    if (callbacks && typeof callbacks !== 'function' && 'onNodeMutation' in callbacks) {
                        virtualNode.observer.init = {
                            subtree: true,
                            childList: true,
                            characterData: true,
                            attributes: true,
                        }
                        virtualNode.observer.callback = m => callbacks.onNodeMutation!(node, m)
                    }
                    nextCallbackMap.set(newKey, callbacks)
                    nextVirtualNodesMap.set(newKey, virtualNode)
                }
            }
        }
        //#endregion

        //#region Key is the same, but node is changed
        // Do: Change reference
        const oldSameKeys = intersectionWith(this.lastKeyList, thisKeyList, this.keyComparer)
        const newSameKeys = intersectionWith(thisKeyList, this.lastKeyList, this.keyComparer)
        type U = [T, T, unknown, unknown]
        const changedNodes = oldSameKeys
            .map(x => [findFromLast(x), findFromNew(x), x, newSameKeys.find(newK => this.keyComparer(newK, x))] as U)
            .filter(([a, b]) => this.valueComparer(a, b) === false)
        for (const [oldNode, newNode, oldKey, newKey] of changedNodes) {
            if (newNode instanceof Element) {
                const virtualNode = this.lastVirtualNodesMap.get(oldKey)!
                virtualNode.realCurrent = newNode

                const fn = this.lastCallbackMap.get(oldKey)
                // This should be ordered. So keep it sync now.
                applyUseForeachCallback(fn)('target change')(oldNode, newNode)
            }
        }
        //#endregion

        // Key is the same, node is the same
        // Do: nothing

        // #region Final: Copy the same keys
        for (const newKey of newSameKeys) {
            const oldKey = oldSameKeys.find(oldKey => this.keyComparer(newKey, oldKey))
            nextCallbackMap.set(newKey, this.lastCallbackMap.get(oldKey))
            nextVirtualNodesMap.set(newKey, this.lastVirtualNodesMap.get(oldKey)!)
        }
        this.lastCallbackMap = nextCallbackMap
        this.lastVirtualNodesMap = nextVirtualNodesMap
        this.lastKeyList = thisKeyList
        this.lastNodeList = currentIteration

        if (this.listenerCount('onIteration') && changedNodes.length + goneKeys.length + newKeys.length) {
            // Make a copy to prevent modifications
            this.emit('onIteration', {
                keys: {
                    current: thisKeyList,
                    new: newKeys,
                    removed: goneKeys,
                },
                values: {
                    current: currentIteration,
                    new: newKeys.map(findFromNew),
                    removed: goneKeys.map(findFromLast),
                },
            } as OnIterationEvent<T>)
        }
        if (this.listenerCount('onChange'))
            for (const [oldNode, newNode, oldKey, newKey] of changedNodes) {
                this.emit('onChange', { oldValue: oldNode, newValue: newNode, oldKey, newKey })
            }
        if (this.listenerCount('onRemove'))
            for (const key of goneKeys) {
                this.emit('onRemove', { key, value: findFromLast(key)! })
            }
        if (this.listenerCount('onRemove'))
            for (const key of newKeys) {
                this.emit('onRemove', { key, value: findFromNew(key)! })
            }
        // For firstVirtualNode
        const first = currentIteration[0]
        if (first instanceof Element) {
            this._firstVirtualNode.realCurrent = first
        } else if (first === undefined || first === null) {
            this._firstVirtualNode.realCurrent = null
        }
        //#endregion

        //#region Prompt developer to open single mode
        if (process.env.NODE_ENV === 'development') {
            if (Watcher.singleModePrompted) return
            const [singleCount, totalCount] = this.singleModePrompt
            if (totalCount > 15 && singleCount === totalCount) {
                console.warn(
                    '[@holoflows/kit] Watcher: Your watcher seems like only watching 1 node. If you can make sure there is only 1 node to watch, call `.enableSingleMode()` on the watcher. This can improve performance.\n',
                    this.stack,
                )
                Watcher.singleModePrompted = true
            } else {
                if (currentIteration.length >= 1) this.singleModePrompt[1]++
                if (currentIteration.length === 1) this.singleModePrompt[0]++
            }
        }
        //#endregion
    }
    /** Should be called every watch */
    protected watcherCallback = (deadline?: Deadline) => {
        if (!this.watching) return

        const thisNodes: readonly T[] | T = this.liveSelector.evaluateOnce()

        if (this.singleMode) return this.singleModeWatcherCallback(thisNodes as T)
        else return this.normalModeWatcherCallback(thisNodes as readonly T[])
    }
    //#endregion

    //#region events
    addListener(event: 'onIteration', fn: EventCallback<OnIterationEvent<T>>): this
    addListener(event: 'onChange', fn: EventCallback<OnChangeEvent<T>>): this
    addListener(event: 'onRemove', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    addListener(event: 'onAdd', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    addListener(event: string, fn: (...args: any[]) => void): this {
        if (event === 'onIteration') this.noNeedInSingleMode('addListener("onIteration", ...)')
        this.eventEmitter.addListener(event, fn)
        return this
    }
    removeListener(event: 'onIteration', fn: EventCallback<OnIterationEvent<T>>): this
    removeListener(event: 'onChange', fn: EventCallback<OnChangeEvent<T>>): this
    removeListener(event: 'onRemove', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    removeListener(event: 'onAdd', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    removeListener(event: string, fn: (...args: any[]) => void): this {
        this.eventEmitter.removeListener(event, fn)
        return this
    }
    protected emit(event: 'onIteration', data: OnIterationEvent<T>): boolean
    protected emit(event: 'onChange', data: OnChangeEvent<T>): boolean
    protected emit(event: 'onRemove', data: OnAddOrRemoveEvent<T>): boolean
    protected emit(event: 'onAdd', data: OnAddOrRemoveEvent<T>): boolean
    protected emit(event: string | symbol, data: any) {
        return this.eventEmitter.emit(event, { data })
    }
    protected listenerCount(event: 'onIteration' | 'onChange' | 'onRemove' | 'onAdd'): number {
        return this.eventEmitter.listenerCount(event)
    }
    //#endregion
    protected _firstVirtualNode = DomProxy<any, Before, After>(this.domProxyOption)
    /**
     * This virtualNode always point to the first node in the LiveSelector
     */
    public get firstVirtualNode() {
        return (this._firstVirtualNode as unknown) as T extends Element ? DomProxy<T, Before, After> : never
    }
    //#region For multiple nodes injection
    /**
     * Map `Node -> Key`, in case of you don't want the default behavior
     */
    protected mapNodeToKey: (node: T, index: number, arr: readonly T[]) => unknown = defaultMapNodeToKey
    /**
     * Compare between `key` and `key`, in case of you don't want the default behavior
     */
    protected keyComparer: (a: unknown, b: unknown) => boolean = defaultEqualityComparer
    /**
     * Compare between `value` and `value`, in case of you don't want the default behavior
     */
    protected valueComparer: (a: T, b: T) => boolean = defaultEqualityComparer
    /**
     * To help identify same nodes in different iteration,
     * you need to implement a map function that map `node` to `key`
     *
     * If the key is changed, the same node will call through `forEachRemove` then `forEach`
     *
     * @param keyAssigner - map `node` to `key`, defaults to `node => node`
     */
    assignKeys<Q = unknown>(keyAssigner: (node: T, index: number, arr: readonly T[]) => Q) {
        this.noNeedInSingleMode(this.assignKeys.name)
        this.mapNodeToKey = keyAssigner
        return this
    }
    /**
     * To help identify same nodes in different iteration,
     * you need to implement a map function to compare `node` and `key`
     *
     * @param keyComparer - compare between two keys, defaults to `===`
     * @param valueComparer - compare between two value, defaults to `===`
     */
    setComparer<Q = unknown>(keyComparer?: (a: Q, b: Q) => boolean, valueComparer?: (a: T, b: T) => boolean) {
        if (keyComparer) this.noNeedInSingleMode(this.setComparer.name)
        if (keyComparer) this.keyComparer = keyComparer
        if (valueComparer) this.valueComparer = valueComparer
        return this
    }
    protected singleMode = false
    /**
     * [single result count, total iterations]. if [0] === [1] and >= N
     * prompt to switch to single mode.
     */
    private singleModePrompt = [0, 0]
    static singleModePrompted = false
    /**
     * Child class have to implement it to get the correct type.
     */
    public abstract enableSingleMode(): Watcher<T, Before, After, true>
    protected _enableSingleMode() {
        this.singleMode = true
        this.liveSelector.enableSingleMode()
    }
    protected noNeedInSingleMode(method: string) {
        if (this.singleMode) console.warn(`[@holoflows/kit] Method ${method} has no effect in Single Mode watcher`)
    }
    /** Saved useForeach */
    protected useForeachFn?: useForeachFn<T, Before, After>
    /**
     * Just like React hooks. Provide callbacks for each node changes.
     *
     * @param forEachFunction - You can return a set of functions that will be called on changes.
     *
     * @remarks
     *
     * Return value of `fn`
     *
     * - `void`: No-op
     *
     * - `((oldNode: T) => void)`: it will be called when the node is removed.
     *
     * - `{ onRemove?: (old: T) => void; onTargetChanged?: (oldNode: T, newNode: T) => void; onNodeMutation?: (node: T) => void }`,
     *
     * - - `onRemove` will be called when node is removed.
     *
     * - - `onTargetChanged` will be called when the node is still existing but target has changed.
     *
     * - - `onNodeMutation` will be called when the node is the same, but it inner content or attributes are modified.
     */
    public useForeach(forEachFunction: NonNullable<typeof typeofFn>, typeofFn = this.useForeachFn) {
        if (this.useForeachFn) {
            console.warn("You can't chain useForeach currently. The old one will be replaced.")
        }
        this.useForeachFn = forEachFunction
        return this
    }

    /**
     * Get virtual node by key.
     * Virtual node will be unavailable if it is deleted
     * @param key - Key used to find DomProxy
     */
    getVirtualNodeByKey(key: unknown) {
        this.noNeedInSingleMode(this.getVirtualNodeByKey.name)
        return (
            this.lastVirtualNodesMap.get([...this.lastVirtualNodesMap.keys()].find(_ => this.keyComparer(_, key))) ||
            null
        )
    }
    //#endregion
}
type OnChangeEvent<T> = {
    oldKey: unknown
    newKey: unknown
    oldValue: T
    newValue: T
}
type OnAddOrRemoveEvent<T> = {
    key: unknown
    value: T
}
type OnIterationEvent<T> = {
    keys: Record<'removed' | 'new' | 'current', unknown[]>
    values: Record<'removed' | 'new' | 'current', T[]>
}
