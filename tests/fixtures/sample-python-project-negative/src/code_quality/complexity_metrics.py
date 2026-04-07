"""Code quality violations: complexity metrics and limits."""


# VIOLATION: code-quality/deterministic/duplicate-string
def use_strings():
    a = "duplicate_string_value"
    b = "duplicate_string_value"
    c = "duplicate_string_value"
    return a + b + c


# VIOLATION: code-quality/deterministic/cognitive-complexity
# VIOLATION: code-quality/deterministic/cyclomatic-complexity
# VIOLATION: code-quality/deterministic/too-many-branches
# VIOLATION: code-quality/deterministic/too-many-return-statements
# VIOLATION: code-quality/deterministic/too-many-statements
# VIOLATION: code-quality/deterministic/too-many-nested-blocks
# VIOLATION: code-quality/deterministic/too-many-boolean-expressions
def extremely_complex(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p):
    result = 0
    v1 = 0
    v2 = 0
    v3 = 0
    v4 = 0
    v5 = 0
    v6 = 0
    v7 = 0
    v8 = 0
    v9 = 0
    v10 = 0
    v11 = 0
    v12 = 0
    v13 = 0
    if a and b and c and d and e and f:
        if g:
            if h:
                if i:
                    if j:
                        if k:
                            result = 1
                            return result
        elif k:
            result = 2
            return result
        elif l:
            result = 3
            return result
        elif m:
            result = 4
            return result
        elif n:
            result = 5
            return result
        elif o:
            result = 6
            return result
        elif p:
            result = 7
            return result
        else:
            result = 8
            return result
    elif a and not b:
        result = 9
        return result
    elif b and not c:
        result = 10
        return result
    elif c and not d:
        result = 11
        return result
    elif d and not e:
        result = 12
        return result
    else:
        result = 13
        return result
    v1 = a + 1
    v2 = b + 2
    v3 = c + 3
    v4 = d + 4
    v5 = e + 5
    v6 = f + 6
    v7 = g + 7
    v8 = h + 8
    v9 = i + 9
    v10 = j + 10
    v11 = k + 11
    v12 = l + 12
    v13 = m + 13
    return result + v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11 + v12 + v13


# VIOLATION: code-quality/deterministic/too-many-positional-arguments
def many_args(a, b, c, d, e, f, g, h):
    return a + b + c + d + e + f + g + h


# VIOLATION: code-quality/deterministic/too-many-locals
def many_locals():
    a = 1
    b = 2
    c = 3
    d = 4
    e = 5
    f = 6
    g = 7
    h = 8
    i = 9
    j = 10
    k = 11
    l = 12
    m = 13
    n = 14
    o = 15
    p = 16
    return a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p


# VIOLATION: code-quality/deterministic/too-many-public-methods
class TooManyMethods:
    def method_01(self): pass
    def method_02(self): pass
    def method_03(self): pass
    def method_04(self): pass
    def method_05(self): pass
    def method_06(self): pass
    def method_07(self): pass
    def method_08(self): pass
    def method_09(self): pass
    def method_10(self): pass
    def method_11(self): pass
    def method_12(self): pass
    def method_13(self): pass
    def method_14(self): pass
    def method_15(self): pass
    def method_16(self): pass
    def method_17(self): pass
    def method_18(self): pass
    def method_19(self): pass
    def method_20(self): pass
    def method_21(self): pass
