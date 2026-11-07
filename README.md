# Crucible

A small expression language: a hand-written lexer, a precedence-climbing parser, and an
evaluator. Supports numbers, strings, variables, comparison, logic, exponentiation and a
handful of builtins — with errors that point at the character that caused them.

Zero dependencies, and **no `eval` or `new Function`** anywhere.

## Run it

```bash
node --test
```

```ts
import { run } from "./src/expression.ts";

run("1 + 2 * 3");                  // 7
run("price - cost", { price: 100, cost: 40 }); // 60
run("max(1, 5, 3) * 2");           // 10
run("len(name) > 3 && active", { name: "Noah", active: true }); // true
```

## The hard part: precedence, done properly

Anyone can split on `+`. The interesting work is the grammar, and Crucible's is explicit:
each parser method owns exactly one precedence tier, so you can read the code top to bottom
and see the precedence table.

```
||  →  &&  →  == !=  →  < <= > >=  →  + -  →  * / %  →  unary  →  **  →  primary
```

Two consequences worth calling out, because both are classic bugs:

- **`**` is right associative.** `2 ** 3 ** 2` is `512`, not `64`. Left-associative
  exponentiation is a quiet wrong-answer generator.
- **Unary minus binds looser than `**` but tighter than `*`.** So `-2 ** 2` is `-4`, matching
  mathematical convention and every other mainstream language.

## Error model

Every error is an `ExpressionError` carrying `message` and `position` (a character offset).
The lexer reports unterminated strings and unknown characters; the parser reports unexpected
tokens, missing `)`, and trailing input; the evaluator reports unknown variables, unknown
functions, bad arity, and division by zero.

Trailing input is an error rather than being ignored: `"1 2"` does not silently evaluate to
`1`, which is the difference between a parser and a regex.

## Design decisions

**Short-circuit evaluation is real.** `false && missing_variable` returns `false` without
touching the right-hand side. If both sides were evaluated eagerly, the whole point of `&&`
in a condition would be lost.

**`+` concatenates when either side is a string.** Mixed types produce `"a1"` rather than
throwing, because that is what template-style expressions expect. Every other arithmetic
operator requires numbers and says so in the error.

**Arithmetic failures are errors, not `NaN`.** `1 / 0` throws with a position. Returning `NaN`
pushes the failure downstream where it is much harder to trace.

**No dynamic code generation.** `eval` would make this ten lines long and would also let any
expression run arbitrary JavaScript. The recursive evaluator only ever does the operations
listed above.

## Tests

Precedence across all tiers, parentheses, right-associative power, unary binding, comparison
and equality, short-circuiting, string concatenation, numeric and decimal lexing with escapes,
variable resolution, positioned errors for unknown variables, builtin arity and dispatch,
division/modulo by zero, and syntax errors with exact offsets — including trailing input and
unterminated strings.
