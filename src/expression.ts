/**
 * A small expression language: lexer -> parser -> evaluator.
 *
 * Nothing here delegates to eval() or Function: the grammar is explicit, so the set of
 * programs that can run is exactly the set the grammar describes.
 */

export class ExpressionError extends Error {
  position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "ExpressionError";
    this.position = position;
  }
}

export type TokenType = "number" | "string" | "identifier" | "operator" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// Longest first, so "**" is never lexed as two "*" tokens.
const OPERATORS = [
  "**", "==", "!=", "<=", ">=", "&&", "||",
  "+", "-", "*", "/", "%", "<", ">", "!", "(", ")", ",",
];

const SINGLE_CHAR_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  '"': '"',
  "'": "'",
};

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      i++;
      continue;
    }

    if (char >= "0" && char <= "9") {
      const start = i;
      while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
      if (input[i] === ".") {
        i++;
        if (!(input[i] >= "0" && input[i] <= "9")) {
          throw new ExpressionError("expected a digit after the decimal point", i);
        }
        while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
      }
      tokens.push({ type: "number", value: input.slice(start, i), position: start });
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const start = i;
      i++;
      let value = "";
      let closed = false;
      while (i < input.length) {
        const current = input[i];
        if (current === "\\") {
          const escaped = input[i + 1];
          if (escaped === undefined) throw new ExpressionError("unterminated escape sequence", i);
          value += SINGLE_CHAR_ESCAPES[escaped] ?? escaped;
          i += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          i++;
          break;
        }
        value += current;
        i++;
      }
      if (!closed) throw new ExpressionError("unterminated string literal", start);
      tokens.push({ type: "string", value, position: start });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = i;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) i++;
      tokens.push({ type: "identifier", value: input.slice(start, i), position: start });
      continue;
    }

    const operator = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (operator) {
      tokens.push({ type: "operator", value: operator, position: i });
      i += operator.length;
      continue;
    }

    throw new ExpressionError(`unexpected character '${char}'`, i);
  }

  tokens.push({ type: "eof", value: "", position: input.length });
  return tokens;
}

export type Node =
  | { kind: "number"; value: number; position: number }
  | { kind: "string"; value: string; position: number }
  | { kind: "boolean"; value: boolean; position: number }
  | { kind: "identifier"; name: string; position: number }
  | { kind: "unary"; operator: string; operand: Node; position: number }
  | { kind: "binary"; operator: string; left: Node; right: Node; position: number }
  | { kind: "call"; name: string; args: Node[]; position: number };

/**
 * Precedence climbing. Each level handles one tier, so the grammar reads top-down exactly
 * as the precedence table does: || < && < equality < comparison < additive < multiplicative
 * < unary < power < primary.
 */
class Parser {
  private tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private advance(): Token {
    return this.tokens[this.index++];
  }

  private matchOperator(...operators: string[]): Token | null {
    const token = this.peek();
    if (token.type === "operator" && operators.includes(token.value)) {
      this.index++;
      return token;
    }
    return null;
  }

  parse(): Node {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing.type !== "eof") {
      throw new ExpressionError(`unexpected '${trailing.value}'`, trailing.position);
    }
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    let token = this.matchOperator("||");
    while (token) {
      const right = this.parseAnd();
      left = { kind: "binary", operator: "||", left, right, position: token.position };
      token = this.matchOperator("||");
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseEquality();
    let token = this.matchOperator("&&");
    while (token) {
      const right = this.parseEquality();
      left = { kind: "binary", operator: "&&", left, right, position: token.position };
      token = this.matchOperator("&&");
    }
    return left;
  }

  private parseEquality(): Node {
    let left = this.parseComparison();
    let token = this.matchOperator("==", "!=");
    while (token) {
      const right = this.parseComparison();
      left = { kind: "binary", operator: token.value, left, right, position: token.position };
      token = this.matchOperator("==", "!=");
    }
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseAdditive();
    let token = this.matchOperator("<", "<=", ">", ">=");
    while (token) {
      const right = this.parseAdditive();
      left = { kind: "binary", operator: token.value, left, right, position: token.position };
      token = this.matchOperator("<", "<=", ">", ">=");
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    let token = this.matchOperator("+", "-");
    while (token) {
      const right = this.parseMultiplicative();
      left = { kind: "binary", operator: token.value, left, right, position: token.position };
      token = this.matchOperator("+", "-");
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    let token = this.matchOperator("*", "/", "%");
    while (token) {
      const right = this.parseUnary();
      left = { kind: "binary", operator: token.value, left, right, position: token.position };
      token = this.matchOperator("*", "/", "%");
    }
    return left;
  }

  private parseUnary(): Node {
    const token = this.matchOperator("!", "-", "+");
    if (token) {
      const operand = this.parseUnary();
      return { kind: "unary", operator: token.value, operand, position: token.position };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePrimary();
    const token = this.matchOperator("**");
    if (token) {
      // Right associative: 2 ** 3 ** 2 is 2 ** (3 ** 2), not (2 ** 3) ** 2.
      const exponent = this.parseUnary();
      return { kind: "binary", operator: "**", left: base, right: exponent, position: token.position };
    }
    return base;
  }

  private parsePrimary(): Node {
    const token = this.peek();

    if (token.type === "number") {
      this.advance();
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new ExpressionError(`invalid number '${token.value}'`, token.position);
      return { kind: "number", value, position: token.position };
    }

    if (token.type === "string") {
      this.advance();
      return { kind: "string", value: token.value, position: token.position };
    }

    if (token.type === "identifier") {
      this.advance();
      if (token.value === "true" || token.value === "false") {
        return { kind: "boolean", value: token.value === "true", position: token.position };
      }
      if (this.matchOperator("(")) {
        const args: Node[] = [];
        if (!this.matchOperator(")")) {
          do {
            args.push(this.parseOr());
          } while (this.matchOperator(","));
          const close = this.matchOperator(")");
          if (!close) throw new ExpressionError(`expected ')' after arguments to ${token.value}`, this.peek().position);
        }
        return { kind: "call", name: token.value, args, position: token.position };
      }
      return { kind: "identifier", name: token.value, position: token.position };
    }

    if (token.type === "operator" && token.value === "(") {
      this.advance();
      const inner = this.parseOr();
      const close = this.matchOperator(")");
      if (!close) throw new ExpressionError("expected ')'", this.peek().position);
      return inner;
    }

    if (token.type === "eof") {
      throw new ExpressionError("unexpected end of expression", token.position);
    }
    throw new ExpressionError(`unexpected '${token.value}'`, token.position);
  }
}

export function parse(source: string): Node {
  return new Parser(lex(source)).parse();
}

export type Environment = Record<string, unknown>;

function truthy(value: unknown): boolean {
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value.length > 0;
  return true;
}

function toNumber(value: unknown, position: number, operator: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new ExpressionError(`operator '${operator}' needs a number, got ${typeof value}`, position);
}

const BUILTINS: Record<string, { min: number; max: number; fn: (args: unknown[]) => unknown }> = {
  min: { min: 1, max: 8, fn: (a) => Math.min(...a.map((v) => Number(v))) },
  max: { min: 1, max: 8, fn: (a) => Math.max(...a.map((v) => Number(v))) },
  abs: { min: 1, max: 1, fn: (a) => Math.abs(Number(a[0])) },
  round: { min: 1, max: 2, fn: (a) => (a.length === 2 ? Math.round(Number(a[0]) * 10 ** Number(a[1])) / 10 ** Number(a[1]) : Math.round(Number(a[0]))) },
  floor: { min: 1, max: 1, fn: (a) => Math.floor(Number(a[0])) },
  ceil: { min: 1, max: 1, fn: (a) => Math.ceil(Number(a[0])) },
  len: {
    min: 1,
    max: 1,
    fn: (a) => {
      const value = a[0];
      if (typeof value === "string") return value.length;
      if (Array.isArray(value)) return value.length;
      throw new ExpressionError("len() expects a string or an array", 0);
    },
  },
  upper: { min: 1, max: 1, fn: (a) => String(a[0]).toUpperCase() },
  lower: { min: 1, max: 1, fn: (a) => String(a[0]).toLowerCase() },
};

export function evaluate(node: Node, env: Environment = {}): unknown {
  switch (node.kind) {
    case "number":
    case "string":
    case "boolean":
      return node.value;

    case "identifier": {
      if (!Object.hasOwn(env, node.name)) {
        throw new ExpressionError(`unknown variable '${node.name}'`, node.position);
      }
      return env[node.name];
    }

    case "unary": {
      if (node.operator === "!") return !truthy(evaluate(node.operand, env));
      if (node.operator === "-") return -toNumber(evaluate(node.operand, env), node.position, "-");
      return toNumber(evaluate(node.operand, env), node.position, "+");
    }

    case "binary": {
      const { operator } = node;

      // Short circuit: the right-hand side is never evaluated when the left decides it.
      if (operator === "&&") return truthy(evaluate(node.left, env)) && truthy(evaluate(node.right, env));
      if (operator === "||") return truthy(evaluate(node.left, env)) || truthy(evaluate(node.right, env));

      const left = evaluate(node.left, env);
      const right = evaluate(node.right, env);

      if (operator === "+") {
        if (typeof left === "string" || typeof right === "string") return `${String(left)}${String(right)}`;
        return toNumber(left, node.position, "+") + toNumber(right, node.position, "+");
      }
      if (operator === "==") return left === right;
      if (operator === "!=") return left !== right;
      if (operator === "<" || operator === "<=" || operator === ">" || operator === ">=") {
        if (typeof left === "string" && typeof right === "string") {
          return operator === "<" ? left < right
            : operator === "<=" ? left <= right
            : operator === ">" ? left > right
            : left >= right;
        }
        const a = toNumber(left, node.position, operator);
        const b = toNumber(right, node.position, operator);
        return operator === "<" ? a < b : operator === "<=" ? a <= b : operator === ">" ? a > b : a >= b;
      }

      const a = toNumber(left, node.position, operator);
      const b = toNumber(right, node.position, operator);
      switch (operator) {
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          if (b === 0) throw new ExpressionError("division by zero", node.position);
          return a / b;
        case "%":
          if (b === 0) throw new ExpressionError("modulo by zero", node.position);
          return a % b;
        case "**":
          return a ** b;
        default:
          throw new ExpressionError(`unknown operator '${operator}'`, node.position);
      }
    }

    case "call": {
      const builtin = BUILTINS[node.name];
      if (!builtin) throw new ExpressionError(`unknown function '${node.name}'`, node.position);
      if (node.args.length < builtin.min || node.args.length > builtin.max) {
        throw new ExpressionError(
          `${node.name}() takes ${builtin.min}-${builtin.max} arguments, received ${node.args.length}`,
          node.position,
        );
      }
      const args = node.args.map((arg) => evaluate(arg, env));
      try {
        return builtin.fn(args);
      } catch (err) {
        if (err instanceof ExpressionError) throw new ExpressionError(err.message, node.position);
        throw err;
      }
    }
  }
}

export function run(source: string, env: Environment = {}): unknown {
  return evaluate(parse(source), env);
}
