import type { Provider, SponsorkitConfig, Sponsorship } from '../types'
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'

export const MooncellProvider: Provider = {
  name: 'mooncell',
  fetchSponsors(config) {
    return fetchMooncellSponsors(config.mooncell)
  },
}

export async function fetchMooncellSponsors(options: SponsorkitConfig['mooncell'] = {}) {
  if (!options || !options.path)
    throw new Error('Mooncell data path is required')

  const data = parse<Record<string, string>>(readFileSync(options?.path, 'utf-8'), {
    columns: true,
    skip_empty_lines: true,
  })
  const sponsors: Record<string, Sponsorship> = {}
  const processed: Sponsorship[] = []
  data.filter((row: Record<string, string>) => row['来自'] !== '/').forEach((ele: Record<string, string>) => {
    const userName = ele['来自']
    if (sponsors[userName])
      sponsors[userName].monthlyDollars += Number.parseFloat(ele['金额'])

    const userNameLastLetter = userName.length >= 2
      ? userName.slice(userName.length - 2, userName.length)
      : userName.charAt(userName.length - 1)
    const avatarText = userNameLastLetter.toUpperCase().replaceAll('*', '')

    sponsors[userName] = {
      sponsor: {
        type: 'User',
        login: userName,
        name: userName,
        avatarUrl: `https://ui-avatars.com/api/?name=${avatarText}&background=random`,
        linkUrl: '',
      },
      // all_sum_amount is based on cny
      monthlyDollars: new Date(ele['时间']).getMonth() !== (new Date()).getMonth()
        ? -1
        : Number.parseFloat(ele['金额']),
      privacyLevel: 'PUBLIC',
      tierName: ele['来源'],
      createdAt: new Date(ele['时间']).toISOString(),
      expireAt: new Date(ele['时间']).toISOString(),
      isOneTime: true,
      provider: 'mooncell',
      raw: ele,
    }
  })
  Object.entries(sponsors).forEach(([_, sponsorship]) => {
    processed.push(sponsorship)
  })

  return processed
}
