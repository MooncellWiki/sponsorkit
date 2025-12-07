import type { Provider, SponsorkitConfig, Sponsorship } from '../types'
import { createHash } from 'node:crypto'
import { $fetch } from 'ofetch'

export async function fetchAfdianMonthlySponsors(
  options: SponsorkitConfig['afdian'] = {},
): Promise<Sponsorship[]> {
  const { webAuthToken, exchangeRate = 6.5 } = options

  if (!webAuthToken)
    throw new Error('Afdian web auth_token are required')

  const orders: any[] = []
  const ordersApi = 'https://afdian.com/api/my/sponsored-bill-filter'
  let page = 1
  let has_more
  do {
    const ordersData = await $fetch(ordersApi, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `auth_token=${webAuthToken}`,
      },
      responseType: 'json',
      query: {
        page,
        sort_field: 'update_time',
        sort_value: 'desc',
        is_redeem: '0',
        plan_id: '',
        sign_status: '',
        has_remark: '0',
        status: '',
        order_id: '',
        nick_name: '',
        remark: '',
        express_no: '',
      },
    })
    page += 1
    if (ordersData?.ec !== 200)
      break
    has_more = ordersData.data.has_more
    orders.push(...ordersData.data.list)
  } while (has_more === 1)

  const sponsors: Record<string, {
    plans: {
      isOneTime: boolean
      amount: number
      month: number
      monthlyAmount: number
      beginTime: number
      endTime: number
      isExpired: boolean
    }[]
    id: string
    name: string
    avatar: string
  }> = {}
  orders.forEach((order) => {
    if (!sponsors[order.user.user_id]) {
      sponsors[order.user.user_id] = {
        plans: [],
        id: order.user.user_id,
        name: order.user.name,
        avatar: order.user.avatar,
      }
    }
    const isOneTime = Array.isArray(order.plan) && order.plan.length === 0

    sponsors[order.user.user_id].plans.push({
      isOneTime,
      amount: Number.parseFloat(order.total_amount),
      month: order.month,
      monthlyAmount: Number.parseFloat(order.total_amount) / order.month,
      beginTime: order.time_range.begin_time,
      endTime: order.time_range.end_time,
      isExpired: order.time_range.end_time < Date.now() / 1000,
    })
  })

  const processed = Object.entries(sponsors).map(([userId, userData]): Sponsorship => {
    let name = userData.name
    if (name.startsWith('爱发电用户_'))
      name = userData.name.slice(6)
    const avatarUrl = userData.avatar

    return {
      sponsor: {
        type: 'User',
        login: userId,
        name,
        avatarUrl,
        linkUrl: `https://afdian.com/u/${userData.id}`,
      },
      // all_sum_amount is based on cny
      monthlyDollars: userData.plans.every((plan: any) => plan.isExpired)
        ? -1
        : userData.plans.filter(plan => !plan.isExpired).map(plan => plan.monthlyAmount / exchangeRate).reduce((acc, curr) => acc + curr, 0),
      privacyLevel: 'PUBLIC',
      tierName: 'Afdian',
      // ASC
      createdAt: new Date(userData.plans.map(plan => plan.beginTime).sort((a, b) => a - b)[0] * 1000).toISOString(),
      // DESC
      expireAt: new Date(userData.plans.map(plan => plan.beginTime).sort((a, b) => b - a)[0] * 1000).toISOString(),
      // empty string means no plan, consider as one time sponsor
      isOneTime: userData.plans.every((plan: any) => plan.isOneTime),
      provider: 'afdian',
      raw: userData,
    }
  })

  return processed
}

// afdian api docs https://afdian.net/p/9c65d9cc617011ed81c352540025c377

export const AfdianProvider: Provider = {
  name: 'afdian',
  fetchSponsors(config) {
    return config.afdian?.webAuthToken ? fetchAfdianMonthlySponsors(config.afdian) : fetchAfdianSponsors(config.afdian)
  },
}

export async function fetchAfdianSponsors(options: SponsorkitConfig['afdian'] = {}): Promise<Sponsorship[]> {
  const {
    userId,
    token,
    exchangeRate = 6.5,
    includePurchases = true,
    purchaseEffectivity = 30,
  } = options

  if (!userId || !token)
    throw new Error('Afdian id and token are required')

  const sponsors: any[] = []
  const sponsorshipApi = 'https://afdian.com/api/open/query-sponsor'
  let page = 1
  let pages = 1
  do {
    const params = JSON.stringify({ page })
    const ts = Math.round(+new Date() / 1000)
    const sign = md5(token, params, ts, userId)
    const sponsorshipData = await $fetch(sponsorshipApi, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      responseType: 'json',
      body: {
        user_id: userId,
        params,
        ts,
        sign,
      },
    })
    page += 1
    if (sponsorshipData?.ec !== 200)
      break
    pages = sponsorshipData.data.total_page
    if (!includePurchases) {
      sponsorshipData.data.list = sponsorshipData.data.list.filter((sponsor: any) => {
        const current = sponsor.current_plan
        if (!current || current.product_type === 0)
          return true
        return false
      })
    }
    if (purchaseEffectivity > 0) {
      sponsorshipData.data.list = sponsorshipData.data.list.map((sponsor: any) => {
        const current = sponsor.current_plan
        if (!current || current.product_type === 0)
          return sponsor
        const expireTime = current.update_time + purchaseEffectivity * 24 * 3600
        sponsor.current_plan.expire_time = expireTime
        return sponsor
      })
    }
    sponsors.push(...sponsorshipData.data.list)
  } while (page <= pages)

  const processed = sponsors.map((raw: any): Sponsorship => {
    const current = raw.current_plan
    const expireTime = current?.expire_time
    const isExpired = expireTime ? expireTime < Date.now() / 1000 : true
    let name = raw.user.name
    if (name.startsWith('爱发电用户_'))
      name = raw.user.user_id.slice(0, 5)
    const avatarUrl = raw.user.avatar
    return {
      sponsor: {
        type: 'User',
        login: raw.user.user_id,
        name,
        avatarUrl,
        linkUrl: `https://afdian.com/u/${raw.user.user_id}`,
      },
      // all_sum_amount is based on cny
      monthlyDollars: isExpired
        ? -1
        : Number.parseFloat(raw.current_plan.show_price) / exchangeRate,
      privacyLevel: 'PUBLIC',
      tierName: 'Afdian',
      createdAt: new Date(raw.first_pay_time * 1000).toISOString(),
      expireAt: expireTime ? new Date(expireTime * 1000).toISOString() : undefined,
      // empty string means no plan, consider as one time sponsor
      isOneTime: Boolean(raw.current_plan?.name),
      provider: 'afdian',
      raw,
    }
  })

  return processed
}

function md5(token: string, params: string, ts: number, userId: string) {
  return createHash('md5').update(`${token}params${params}ts${ts}user_id${userId}`).digest('hex')
}
