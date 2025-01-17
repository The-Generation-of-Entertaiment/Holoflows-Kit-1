<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@holoflows/kit](./kit.md) &gt; [WatcherEvents](./kit.watcherevents.md)

## WatcherEvents interface

<b>Signature:</b>

```typescript
export interface WatcherEvents<T> 
```

## Events

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [onAdd](./kit.watcherevents.onadd.md) |  | \[ { key: unknown; value: T; } \] |  |
|  [onChange](./kit.watcherevents.onchange.md) |  | \[ { oldKey: unknown; newKey: unknown; oldValue?: T; newValue: T; } \] |  |
|  [onIteration](./kit.watcherevents.oniteration.md) |  | \[ { new: Map&lt;unknown, T&gt;; removed: Map&lt;unknown, T&gt;; current: Map&lt;unknown, T&gt;; } \] |  |
|  [onRemove](./kit.watcherevents.onremove.md) |  | \[ { key: unknown; value: T; } \] |  |

