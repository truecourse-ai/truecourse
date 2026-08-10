/**
 * ISBN normalisation, shared by the HTTP service and the `bookclub` CLI so both
 * agree on what a book's identity is: every ISBN is stored as 13 digits.
 */

/** An ISBN-10 or ISBN-13 as 13 digits, or null when it is not a valid ISBN. */
export function normalizeIsbn(input) {
  if (typeof input !== 'string') return null
  const digits = input.replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{9}[\dX]$/.test(digits)) return toIsbn13(digits)
  if (/^\d{13}$/.test(digits)) return isbn13Checksum(digits.slice(0, 12)) === digits[12] ? digits : null
  return null
}

function toIsbn13(isbn10) {
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const value = isbn10[i] === 'X' ? 10 : Number(isbn10[i])
    sum += value * (10 - i)
  }
  if (sum % 11 !== 0) return null
  const body = `978${isbn10.slice(0, 9)}`
  return body + isbn13Checksum(body)
}

function isbn13Checksum(body) {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3)
  return String((10 - (sum % 10)) % 10)
}
