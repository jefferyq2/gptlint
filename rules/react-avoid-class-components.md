# Don't use React class components

| Key       | Value                          |
| --------- | ------------------------------ |
| Name      | `react-avoid-class-components` |
| Level     | error                          |
| Fixable   | false                          |
| Tags      | react                          |
| Languages | javascript, typescript         |

React class components are deprecated. Use React functions and hooks instead.

Note that uses `classes` is fine for non-react components.

### Bad

```tsx
import { Component } from 'react'

export class Label extends Component {
  render() {
    return <div>Hello</div>
  }
}
```

```tsx
import react from 'react'

export class Label extends react.Component {
  render() {
    return <div />
  }
}
```

### Good

```tsx
export function Button() {
  return <div>Hello</div>
}
```

```ts
import EventEmitter from 'eventemitter3'

// This is fine because it is a normal class and not a React component.
class Foo extends EventEmitter {
  constructor() {}
}
```