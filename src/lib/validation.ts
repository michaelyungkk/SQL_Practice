import type { Challenge, QueryResult, ValidationFeedback } from '../types'

const normalizeCell = (value: string | number | null) => {
  if (typeof value === 'number') {
    return Number(value.toFixed(4))
  }

  return value
}

const normalizeColumns = (columns: QueryResult['columns']) => columns.map((column) => column.trim())

const normalizeRows = (rows: QueryResult['rows']) => rows.map((row) => row.map((value) => normalizeCell(value)))

const rowKey = (row: QueryResult['rows'][number]) => JSON.stringify(row.map((value) => normalizeCell(value)))

const isOrderedChallenge = (challenge: Challenge) => {
  const upperSql = challenge.solutionSql.toUpperCase()

  return (
    upperSql.includes('ORDER BY') ||
    upperSql.includes('LIMIT') ||
    upperSql.includes('ROW_NUMBER() OVER') ||
    upperSql.includes('RANK() OVER') ||
    upperSql.includes('DENSE_RANK() OVER')
  )
}

const formatRow = (row: QueryResult['rows'][number]) =>
  `(${row.map((value) => (value === null ? 'NULL' : String(value))).join(', ')})`

const compareRowSets = (expectedRows: QueryResult['rows'], userRows: QueryResult['rows']) => {
  const expectedCounts = new Map<string, number>()
  const userCounts = new Map<string, number>()

  expectedRows.forEach((row) => {
    const key = rowKey(row)
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1)
  })

  userRows.forEach((row) => {
    const key = rowKey(row)
    userCounts.set(key, (userCounts.get(key) ?? 0) + 1)
  })

  const missingRows: string[] = []
  const unexpectedRows: string[] = []

  expectedCounts.forEach((expectedCount, key) => {
    const actualCount = userCounts.get(key) ?? 0
    if (actualCount < expectedCount) {
      const sampleRow = expectedRows.find((row) => rowKey(row) === key)
      if (sampleRow) {
        missingRows.push(`${formatRow(sampleRow)} x ${expectedCount - actualCount}`)
      }
    }
  })

  userCounts.forEach((actualCount, key) => {
    const expectedCount = expectedCounts.get(key) ?? 0
    if (actualCount > expectedCount) {
      const sampleRow = userRows.find((row) => rowKey(row) === key)
      if (sampleRow) {
        unexpectedRows.push(`${formatRow(sampleRow)} x ${actualCount - expectedCount}`)
      }
    }
  })

  return { missingRows, unexpectedRows }
}

const keywordHints = (sql: string, challenge: Challenge) => {
  const upperSql = sql.toUpperCase()
  const solutionSql = challenge.solutionSql.toUpperCase()
  const extraHints: string[] = []

  if (!upperSql.includes('SELECT')) {
    extraHints.push('Your query still needs a `SELECT` statement.')
  }
  if (solutionSql.includes('JOIN') && !upperSql.includes('JOIN')) {
    extraHints.push('This challenge expects data from more than one table, so check whether a join is missing.')
  }
  if (solutionSql.includes('GROUP BY') && !upperSql.includes('GROUP BY')) {
    extraHints.push('The result likely needs grouping before the metric can be correct.')
  }
  if (solutionSql.includes('WHERE') && !upperSql.includes('WHERE')) {
    extraHints.push('You may be missing a filter needed to narrow the result.')
  }
  if (solutionSql.includes('HAVING') && !upperSql.includes('HAVING')) {
    extraHints.push('A grouped filter belongs in `HAVING`, not `WHERE`.')
  }
  if (solutionSql.includes('OVER') && !upperSql.includes('OVER')) {
    extraHints.push('This one is looking for a window function.')
  }
  if (solutionSql.includes('CASE') && !upperSql.includes('CASE')) {
    extraHints.push('This challenge needs a `CASE` expression to build the right bucket or label.')
  }
  if (solutionSql.includes('DISTINCT') && !upperSql.includes('DISTINCT')) {
    extraHints.push('This answer needs `DISTINCT` to remove duplicate values.')
  }
  if (solutionSql.includes('WITH ') && !upperSql.includes('WITH ')) {
    extraHints.push('This challenge probably starts with a common table expression (`WITH`).')
  }

  return extraHints
}

const compareSortedRows = (leftRows: QueryResult['rows'], rightRows: QueryResult['rows']) => {
  const left = leftRows.map((row) => JSON.stringify(row)).sort((a, b) => a.localeCompare(b))
  const right = rightRows.map((row) => JSON.stringify(row)).sort((a, b) => a.localeCompare(b))

  return JSON.stringify(left) === JSON.stringify(right)
}

export const compareResults = (
  challenge: Challenge,
  userSql: string,
  userResult: QueryResult,
  expectedResult: QueryResult,
): ValidationFeedback => {
  const normalizedExpectedColumns = normalizeColumns(expectedResult.columns)
  const normalizedUserColumns = normalizeColumns(userResult.columns)
  const columnCountMatches = normalizedUserColumns.length === normalizedExpectedColumns.length
  const columnNamesMatch = normalizedUserColumns.join('|') === normalizedExpectedColumns.join('|')

  if (!columnCountMatches || !columnNamesMatch) {
    const missingColumns = normalizedExpectedColumns.filter((column, index) => normalizedUserColumns[index] !== column)
    const unexpectedColumns = normalizedUserColumns.filter((column, index) => normalizedExpectedColumns[index] !== column)

    return {
      status: 'error',
      title: 'Column mismatch',
      message: 'The query returned rows, but the output columns do not match the lesson target.',
      detail: [
        `Expected columns: ${normalizedExpectedColumns.join(', ')}.`,
        missingColumns.length > 0 ? `Missing or renamed: ${missingColumns.join(', ')}.` : null,
        unexpectedColumns.length > 0 ? `Returned instead: ${unexpectedColumns.join(', ')}.` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' '),
    }
  }

  const preserveOrder = isOrderedChallenge(challenge)
  const normalizedExpectedRows = normalizeRows(expectedResult.rows)
  const normalizedUserRows = normalizeRows(userResult.rows)
  const rowsMatch = preserveOrder
    ? JSON.stringify(normalizedUserRows) === JSON.stringify(normalizedExpectedRows)
    : compareSortedRows(normalizedUserRows, normalizedExpectedRows)

  if (!rowsMatch) {
    const hints = keywordHints(userSql, challenge)
    const { missingRows, unexpectedRows } = compareRowSets(expectedResult.rows, userResult.rows)
    const orderOnlyMismatch =
      preserveOrder && compareSortedRows(normalizedUserRows, normalizedExpectedRows)

    return {
      status: 'error',
      title: orderOnlyMismatch ? 'Correct rows, wrong order' : 'Close, but not correct yet',
      message: orderOnlyMismatch
        ? 'The query returned the right rows, but not in the expected order.'
        : 'The query ran, but the returned data does not match the expected answer.',
      detail:
        hints[0] ??
        [
          orderOnlyMismatch ? 'The values are right, but the row order needs to change.' : null,
          missingRows.length > 0 ? `Missing rows: ${missingRows.slice(0, 3).join(', ')}.` : null,
          unexpectedRows.length > 0 ? `Unexpected rows: ${unexpectedRows.slice(0, 3).join(', ')}.` : null,
          `Expected result shape: ${challenge.expectedColumns.join(', ')}.`,
        ]
          .filter((part): part is string => Boolean(part))
          .join(' '),
    }
  }

  return {
    status: 'success',
    title: 'Challenge cleared',
    message: 'Your result matches the expected output. Nicely done.',
    detail: challenge.explanation,
  }
}

export const syntaxFeedback = (error: unknown): ValidationFeedback => {
  const message = error instanceof Error ? error.message : 'Unknown SQL error'

  return {
    status: 'error',
    title: 'SQL error',
    message: 'SQLite could not run that query yet.',
    detail: message,
  }
}
