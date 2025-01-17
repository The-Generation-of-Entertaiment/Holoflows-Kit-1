<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@holoflows/kit](./kit.md) &gt; [LiveSelector](./kit.liveselector.md) &gt; [filter](./kit.liveselector.filter.md)

## LiveSelector.filter() method

Select the elements of a LiveSelector that meet the condition specified in a callback function.

<b>Signature:</b>

```typescript
filter(f: (value: T, index: number, array: T[]) => any): LiveSelector<NonNullable<T>, SingleMode>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  f | (value: T, index: number, array: T\[\]) =&gt; any | The filter method |

<b>Returns:</b>

[LiveSelector](./kit.liveselector.md)<!-- -->&lt;NonNullable&lt;T&gt;, SingleMode&gt;

## Example


```ts
ls.filter(x => x.innerText.match('hello'))
```

