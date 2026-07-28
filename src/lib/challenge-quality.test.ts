import { describe, expect, it } from 'vitest'

import { allChallenges, lessonsByTrack } from '../data/gameContent'
import { runSql } from './database'
import { compareResults } from './validation'

const stripTrailingSemicolon = (sql: string) => sql.trim().replace(/;\s*$/, '')

const makeDeliberatelyWrongQuery = (sql: string) => {
  const source = stripTrailingSemicolon(sql)

  return `SELECT * FROM (${source}) AS challenge_result WHERE 1 = 0`
}

describe('challenge quality', () => {
  it.each(allChallenges)('solution for %s runs and validates', async (challenge) => {
    const result = await runSql(challenge.solutionSql)

    expect(result.columns).toEqual(challenge.expectedColumns)
    expect(result.rows.length).toBeGreaterThan(0)

    const feedback = compareResults(challenge, challenge.solutionSql, result, result)
    expect(feedback.status).toBe('success')
  })

  it.each(allChallenges)('deliberately wrong query for %s fails', async (challenge) => {
    const wrongSql = makeDeliberatelyWrongQuery(challenge.solutionSql)
    const wrongResult = await runSql(wrongSql)
    const correctResult = await runSql(challenge.solutionSql)
    const feedback = compareResults(challenge, wrongSql, wrongResult, correctResult)

    expect(feedback.status).toBe('error')
  })

  it('threshold lessons still meaningfully change the result', async () => {
    const challenge = allChallenges.find((item) => item.title === 'Only High-Volume Event Types')

    expect(challenge).toBeTruthy()
    if (!challenge) {
      return
    }

    const correctResult = await runSql(challenge.solutionSql)
    const relaxedSql = challenge.solutionSql.replace(/160/g, '150')
    const relaxedResult = await runSql(relaxedSql)
    const feedback = compareResults(challenge, relaxedSql, relaxedResult, correctResult)

    expect(correctResult.rows.length).toBeGreaterThan(0)
    expect(relaxedResult.rows).not.toEqual(correctResult.rows)
    expect(feedback.status).toBe('error')
  })

  it('price band lesson keeps its bucket boundaries meaningful', async () => {
    const challenge = lessonsByTrack.intermediate.find((item) => item.title === 'Create Price Bands')

    expect(challenge).toBeTruthy()
    if (!challenge) {
      return
    }

    const correctResult = await runSql(challenge.solutionSql)
    const narrowerSql = challenge.solutionSql.replace('price < 120', 'price < 80')
    const narrowerResult = await runSql(narrowerSql)
    const feedback = compareResults(challenge, narrowerSql, narrowerResult, correctResult)

    expect(correctResult.rows.length).toBeGreaterThan(0)
    expect(correctResult.rows.some((row) => row.includes('Premium'))).toBe(true)
    expect(narrowerResult.rows).not.toEqual(correctResult.rows)
    expect(feedback.status).toBe('error')
  })

  it('ordered lessons reject shuffled output', async () => {
    const challenge = allChallenges.find((item) => item.id === 'beginner-06')

    expect(challenge).toBeTruthy()
    if (!challenge) {
      return
    }

    const correctResult = await runSql(challenge.solutionSql)
    const shuffledSql = challenge.solutionSql.replace(/ORDER BY order_date DESC/i, '')
    const shuffledResult = await runSql(shuffledSql)
    const feedback = compareResults(challenge, shuffledSql, shuffledResult, correctResult)

    expect(correctResult.rows.length).toBeGreaterThan(0)
    expect(feedback.status).toBe('error')
  })
})
