import test from "node:test";
import assert from "node:assert/strict";
import { ExpressionError, lex, parse, run } from "../src/expression.ts";

test("multiplication binds tighter than addition", () => {
  assert.equal(run("1 + 2 * 3"), 7);
  assert.equal(run("2 * 3 + 1"), 7);
  assert.equal(run("10 - 4 / 2"), 8);
  assert.equal(run("1 + 2 * 3 - 4 / 2"), 5);
});

test("parentheses override precedence", () => {
  assert.equal(run("(1 + 2) * 3"), 9);
  assert.equal(run("((2))"), 2);
  assert.equal(run("(1 + 2) * (3 + 4)"), 21);
});

test("power is right associative", () => {
  assert.equal(run("2 ** 3"), 8);
  assert.equal(run("2 ** 3 ** 2"), 512, "right associative: 2 ** (3 ** 2)");
  assert.equal(run("(2 ** 3) ** 2"), 64, "parentheses change it");
});

test("unary operators bind tighter than arithmetic and looser than power", () => {
  assert.equal(run("-3 + 4"), 1);
  assert.equal(run("-(3 + 4)"), -7);
  assert.equal(run("-2 ** 2"), -4, "the exponent is evaluated first");
  assert.equal(run("!true"), false);
  assert.equal(run("!!1"), true);
  assert.equal(run("+5"), 5);
});

test("comparison and equality produce booleans", () => {
  assert.equal(run("1 < 2"), true);
  assert.equal(run("2 <= 2"), true);
  assert.equal(run("3 > 4"), false);
  assert.equal(run("4 >= 4"), true);
  assert.equal(run("1 == 1"), true);
  assert.equal(run("1 != 1"), false);
  assert.equal(run('"abc" < "abd"'), true, "strings compare lexically");
});

test("logical operators short circuit", () => {
  assert.equal(run("false && missing_variable"), false, "the right side is never evaluated");
  assert.equal(run("true || missing_variable"), true);
  assert.equal(run("1 < 2 && 3 > 4"), false);
  assert.equal(run("1 < 2 || 3 > 4"), true);
  assert.equal(run("true && true && false"), false);
});

test("plus concatenates when either side is a string", () => {
  assert.equal(run('"a" + "b"'), "ab");
  assert.equal(run('"a" + 1'), "a1");
  assert.equal(run('1 + "a"'), "1a");
  assert.equal(run("1 + 2"), 3, "numbers still add numerically");
});

test("numbers, decimals and escapes lex correctly", () => {
  assert.equal(run("3.25 + 0.75"), 4);
  assert.equal(run('"tab\\there"'), "tab\there");
  assert.equal(run('"quote\\"inside"'), 'quote"inside');
  assert.equal(run("'single quoted'"), "single quoted");
});

test("variables resolve from the environment", () => {
  assert.equal(run("x * 2", { x: 21 }), 42);
  assert.equal(run("price - cost", { price: 100, cost: 40 }), 60);
  assert.equal(run("name", { name: "Noah" }), "Noah");
});

test("an unknown variable fails with its position", () => {
  try {
    run("1 + nope");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof ExpressionError);
    assert.match(err.message, /unknown variable 'nope'/);
    assert.equal(err.position, 4);
  }
});

test("builtins are applied and arity checked", () => {
  assert.equal(run("max(1, 5, 3)"), 5);
  assert.equal(run("min(4, 2)"), 2);
  assert.equal(run("abs(-9)"), 9);
  assert.equal(run("len('hello')"), 5);
  assert.equal(run("upper('ab') + lower('CD')"), "ABcd");
  assert.equal(run("round(3.14159, 2)"), 3.14);
  assert.throws(() => run("max()"), ExpressionError, "too few arguments");
  assert.throws(() => run("abs(1, 2)"), ExpressionError, "too many arguments");
  assert.throws(() => run("nope(1)"), ExpressionError, "unknown function");
});

test("arithmetic errors are reported, not returned as NaN", () => {
  assert.throws(() => run("1 / 0"), (err: unknown) => {
    assert.ok(err instanceof ExpressionError);
    assert.match(err.message, /division by zero/);
    return true;
  });
  assert.throws(() => run("1 % 0"), /modulo by zero/);
  assert.throws(() => run ('"abc" - 1'), /needs a number/);
});

test("syntax errors point at the offending character", () => {
  try {
    run("1 + * 2");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof ExpressionError);
    assert.equal(err.position, 4);
  }

  assert.throws(() => run("1 +"), /unexpected end of expression/);
  assert.throws(() => run("(1 + 2"), /expected '\)'/);
  assert.throws(() => run("1 2"), /unexpected '2'/, "trailing input is not silently ignored");
  assert.throws(() => run("'unterminated"), /unterminated string/);
  assert.throws(() => run("1 $ 2"), /unexpected character '\$'/);
  assert.throws(() => run("1. 5"), /expected a digit/);
});

test("the lexer emits positions and an eof sentinel", () => {
  const tokens = lex("a + 12");
  assert.deepEqual(
    tokens.map((t) => [t.type, t.value, t.position]),
    [
      ["identifier", "a", 0],
      ["operator", "+", 2],
      ["number", "12", 4],
      ["eof", "", 6],
    ],
  );
});

test("whitespace and newlines are insignificant", () => {
  assert.equal(run("  1\n+\t2  "), 3);
  assert.equal(parse("1+2").kind, "binary");
});
