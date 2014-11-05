///<reference path='./../../../node_modules/immutable/dist/Immutable.d.ts'/>
'use strict';

// parser for http://lucene.apache.org/core/2_9_4/queryparsersyntax.html

import Immutable = require('immutable');

export interface Visitor {
    visit(ast: AST);
}

export class DumpVisitor implements Visitor {
    private buffer = [];

    visit(ast: AST) {
        if (ast === null) {
            return;
        } else if (ast instanceof ExpressionListAST) {
            this.dumpPrefix(ast);
            var exprList = <ExpressionListAST>ast;
            exprList.expressions.forEach((expr) => this.visit(expr));
            this.dumpSuffix(ast);
        } else if (ast instanceof ExpressionAST) {
            var expr = <ExpressionAST>ast;
            this.dumpPrefix(ast);
            this.visit(expr.left);
            this.dumpToken(expr.op);
            this.visit(expr.right);
            this.dumpSuffix(ast);
        } else if (ast instanceof TermAST) {
            this.dumpWithPrefixAndSuffix(ast);
        }
    }

    private dumpWithPrefixAndSuffix(ast: TermAST) {
        this.dumpPrefix(ast);
        if (ast.field) {
            this.dumpToken(ast.field);
            this.buffer.push(":");
        }
        this.dumpToken(ast.term);
        this.dumpSuffix(ast);
    }

    private dumpSuffix(ast) {
        ast.hiddenSuffixTokens().forEach((suffix) => this.dumpToken(suffix));
    }

    private dumpPrefix(ast) {
        ast.hiddenPrefixTokens().forEach((prefix) => this.dumpToken(prefix));
    }
    private dumpToken(token: Token) {
        token !== null && this.buffer.push(token.asString());
    }

    result() {
        return this.buffer.join("");
    }

}

export enum TokenType {
    EOF, WS, TERM, PHRASE, AND, OR, NOT, COLON
}

export interface AST {
    hiddenPrefixTokens(): Immutable.List<Token>;
    hiddenSuffixTokens(): Immutable.List<Token>;
}

class BaseAST implements AST {
    public hiddenPrefix: Immutable.List<Token> = Immutable.List.of<Token>();
    public hiddenSuffix: Immutable.List<Token> = Immutable.List.of<Token>();

    hiddenPrefixTokens() {
        return this.hiddenPrefix;
    }

    hiddenSuffixTokens() {
        return this.hiddenSuffix;
    }
}

export class ExpressionAST extends BaseAST implements AST {
    constructor(public left: TermAST, public op: Token,
                public right: AST) {
        super();
        this.left = left;
        this.right = right;
        this.op = op;
    }
}

export class TermAST extends BaseAST implements AST {
    constructor(public term: Token, public field?: Token) {
        super();
    }

    isPhrase() {
        return this.term.asString().indexOf(" ") !== -1;
    }
}

export class ExpressionListAST extends BaseAST implements AST {
    public expressions = Immutable.List.of<BaseAST>();
    constructor (...expressions: BaseAST[]) {
        super();
        this.expressions = this.expressions.merge(expressions);
    }

    add(expr: BaseAST) {
        this.expressions = this.expressions.push(expr);
    }
}

export class Token {
    constructor(private input: string, public type: TokenType, public beginPos: number, public endPos: number) {
    }

    asString() {
        return this.input.substring(this.beginPos, this.endPos);
    }
}

class QueryLexer {
    public pos: number;
    private eofToken: Token;

    constructor(private input: string) {
        this.pos = 0;
        this.eofToken = new Token(this.input, TokenType.EOF, input.length - 1, input.length - 1);
    }

    next(): Token {
        var token = this.eofToken;
        var la = this.la();
        if (this.isWhitespace(la)) {
            token = this.whitespace();
        } else if (this.isKeyword("OR")) {
            token = this.or();
        } else if (this.isKeyword("AND")) {
            token = this.and();
        } else if (la === '"') {
            token = this.phrase();
        } else if (this.isDigit(la)) {
            token = this.term();
        } else if (la === ':') {
            var startPos = this.pos;
            this.consume();
            token = new Token(this.input, TokenType.COLON, startPos, this.pos);
        }
        // FIME: no matching token error instead of EOF
        return token;
    }

    isKeyword(keyword: string): boolean {
        for (var i = 0; i < keyword.length; i++) {
            if (this.la(i) !== keyword[i]) {
                return false;
            }
        }
        // be sure that it is not a prefix of something else
        return this.isWhitespace(this.la(i)) || this.la(i) === null;
    }

    or() {
        var startPos = this.pos;
        this.consume(2);
        return new Token(this.input, TokenType.OR, startPos, this.pos);
    }

    and() {
        var startPos = this.pos;
        this.consume(3);
        return new Token(this.input, TokenType.AND, startPos, this.pos);
    }

    whitespace() {
        var startPos = this.pos;
        var la = this.la();
        while (la !== null && this.isWhitespace(la)) {
            this.consume();
            la = this.la();
        }
        return new Token(this.input, TokenType.WS, startPos, this.pos);
    }

    term() {
        var startPos = this.pos;
        var la = this.la();
        while (la !== null && this.isDigit(la)) {
            this.consume();
            la = this.la();
        }
        return new Token(this.input, TokenType.TERM, startPos, this.pos);
    }

    phrase() {
        var startPos = this.pos;
        this.consume(); // skip starting "
        var la = this.la();
        while (la !== null && la !== '"') {
            this.consume();
            la = this.la();
        }
        this.consume(); // skip ending "
        return new Token(this.input, TokenType.PHRASE, startPos, this.pos);
    }

    // TODO: handle escaping using state pattern
    isDigit(char) {
        return char !== null && (('a' <= char && char <= 'z') || ('A' <= char && char <= 'Z') || ('0' <= char && char <= '9'));
    }

    isWhitespace(char) {
        return '\n\r \t'.indexOf(char) !== -1;
    }

    consume(n: number = 1) {
        this.pos += n;
    }

    la(la: number = 0): string {
        var index = this.pos + la;
        return (this.input.length <= index) ? null : this.input[index];
    }
}

export interface ErrorObject {
    position: number;
    message: string;
}

/**
 * Parser for http://lucene.apache.org/core/2_9_4/queryparsersyntax.html
 */
export class QueryParser {
    private lexer: QueryLexer;
    private tokenBuffer: Array<Token>;
    public errors = Immutable.List.of<ErrorObject>();

    constructor(private input: string) {
        this.lexer = new QueryLexer(input);
        this.tokenBuffer = [];
    }

    private consume() {
        this.tokenBuffer.splice(0, 1);
    }

    private la(la: number = 0): Token {
        // fill token buffer until we can look far ahead
        while (la >= this.tokenBuffer.length) {
            var token = this.lexer.next();
            if (token.type === TokenType.EOF) {
                return token;
            }
            this.tokenBuffer.push(token);
        }
        return this.tokenBuffer[la];
    }

    private skipWS(): Immutable.List<Token> {
        return this.syncWhile(TokenType.WS);
    }

    private syncWhile(...syncWhile: TokenType[]): Immutable.List<Token> {
        var skippedTokens = Immutable.List.of<Token>().asMutable();
        while (syncWhile.some((type) => type === this.la().type)) {
            skippedTokens.push(this.la());
            this.consume();
        }
        return skippedTokens.asImmutable();
    }

    private syncTo(syncTo: TokenType[]): Immutable.List<Token> {
        var skippedTokens = Immutable.List.of<Token>().asMutable();
        while (this.la().type !== TokenType.EOF && syncTo.every((type) => type !== this.la().type)) {
            skippedTokens.push(this.la());
            this.consume();
        }
        return skippedTokens.asImmutable();
    }

    private unexpectedToken(...syncTo: TokenType[]) {
        this.errors = this.errors.push({
            position: this.la().beginPos,
            message: "Unexpected input"
        });
        this.syncTo(syncTo);
    }

    private missingToken(tokenName: string, ...syncTo: TokenType[]) {
        this.errors = this.errors.push({
            position: this.la().beginPos,
            message: "Missing " + tokenName
        });
        this.syncTo(syncTo);
    }

    parse(): AST {
        this.errors = this.errors.clear();
        var ast;
        var prefix = this.skipWS();
        ast = this.exprs();
        ast.hiddenPrefix = ast.hiddenPrefix.merge(prefix);
        var trailingSuffix: Immutable.List<Token> = this.skipWS();
        ast.hiddenSuffix = ast.hiddenSuffix.merge(trailingSuffix);
        return ast;
    }

    exprs(): AST {
        var expressionList = new ExpressionListAST();
        var expr = this.expr();

        if (!this.isExpr()) {
            return expr;
        } else {
            expressionList.add(expr);
            while (this.isExpr()) {
                expr = this.expr();
                expressionList.add(expr);
            }
            return expressionList;
        }
    }

    expr(): BaseAST {
        var left: TermAST = null;
        var op: Token = null;
        var right: BaseAST = null;

        // left
        var la = this.la();
        switch (la.type) {
            case TokenType.TERM:
            case TokenType.PHRASE:
                left = this.termOrPhrase();
                break;
            default:
                this.unexpectedToken(TokenType.EOF);
                break;
        }
        left.hiddenSuffix = this.skipWS();

        if (!this.isOperator()) {
            return left;
        } else {
            op = this.la();
            this.consume();
            var prefix = this.skipWS();
            if (this.isExpr()) {
                right = this.expr();
                right.hiddenPrefix = prefix;
            } else {
                this.missingToken("right side of expression", TokenType.EOF);
            }
            return new ExpressionAST(left, op, right);
        }
    }

    isFirstOf(...tokenTypes: TokenType[]) {
        return tokenTypes.some((tokenType) => this.la().type === tokenType);
    }

    isExpr() {
        return this.isFirstOf(TokenType.TERM, TokenType.PHRASE);
    }

    isOperator() {
        return this.isFirstOf(TokenType.OR, TokenType.AND);
    }

    termOrPhrase() {
        var termOrField = this.la();
        this.consume();
        // no ws allowed here
        if (this.la().type === TokenType.COLON) {
            this.consume();
            if (this.la().type === TokenType.TERM || this.la().type === TokenType.PHRASE) {
                var term = this.la();
                this.consume();
                var ast = new TermAST(term, termOrField);
                return ast;
            } else {
                this.missingToken("term or phrase for field", TokenType.EOF);
            }
        }
        var ast = new TermAST(termOrField);
        return ast;
    }
}
