import type { Challenge, QueryResult, ValidationFeedback } from '../types'

const normalizeCell = (value: string | number | null) => {
  if (typeof value === 'number') {
    return Number(value.toFixed(4))
  }

  return value
}

const normalizeRows = (rows: QueryResult['rows']) =>
  [...rows]
    .map((row) => JSON.stringify(row.map((value) => normalizeCell(value))))
    .sort((left, right) => left.localeCompare(right))

const keywordHints = (sql: string, challenge: Challenge) => {
  const upperSql = sql.toUpperCase()
  const extraHints: string[] = []

  if (!upperSql.includes('SELECT')) {
    extraHints.push('Your query still needs a `SELECT` statement.')
  }
  if (challenge.solutionSql.toUpperCase().includes('JOIN') && !upperSql.includes('JOIN')) {
    extraHints.push('This challenge expects data from more than one table, so check whether a join is missing.')
  }
  if (challenge.solutionSql.toUpperCase().includes('GROUP BY') && !upperSql.includes('GROUP BY')) {
    extraHints.push('The result likely needs grouping before the metric can be correct.')
  }
  if (challenge.solutionSql.toUpperCase().includes('WHERE') && !upperSql.includes('WHERE')) {
    extraHints.push('You may be missing a filter needed to narrow the result.')
  }
  if (challenge.solutionSql.toUpperCase().includes('HAVING') && !upperSql.includes('HAVING')) {
    extraHints.push('A grouped filter belongs in `HAVING`, not `WHERE`.')
  }
  if (challenge.solutionSql.toUpperCase().includes('OVER') && !upperSql.includes('OVER')) {
    extraHints.push('This one is looking for a window function.')
  }

  return extraHints
}

export const compareResults = (
  challenge: Challenge,
  userSql: string,
  userResult: QueryResult,
  expectedResult: QueryResult,
): ValidationFeedback => {
  if (userResult.rows.length !== expectedResult.rows.length) {
    return {
      status: 'error',
      title: 'Result shape is off',
      message: `Your query returned ${userResult.rows.length} rows, but the expected result has ${expectedResult.rows.length}.`,
      detail: `Expected columns: ${challenge.expectedColumns.join(', ')}.`,
    }
  }

  if (userResult.columns.length !== expectedResult.columns.length) {
    return {
      status: 'error',
      title: 'Column count mismatch',
      message: `Your query returned ${userResult.columns.length} columns, but the challenge expects ${expectedResult.columns.length}.`,
      detail: `Expected columns: ${challenge.expectedColumns.join(', ')}.`,
    }
  }

  const normalizedUserRows = normalizeRows(userResult.rows)
  const normalizedExpectedRows = normalizeRows(expectedResult.rows)

  if (JSON.stringify(normalizedUserRows) !== JSON.stringify(normalizedExpectedRows)) {
    const hints = keywordHints(userSql, challenge)

    return {
      status: 'error',
      title: 'Close, but not correct yet',
      message: 'The query ran, but the returned data does not match the expected answer.',
      detail:
        hints[0] ??
        `Expected result shape: ${challenge.expectedColumns.join(', ')}. Recheck filters, grouping, joins, and ordering.`,
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
