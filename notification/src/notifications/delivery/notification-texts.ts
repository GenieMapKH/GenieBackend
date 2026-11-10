import { PushTarget } from './push-sender';

type Locale = PushTarget['locale'];

/**
 * What the system shows, in each device's language. The server writes it
 * because a closed app cannot: the phone shows the push as it arrives.
 */
export const texts = {
  newMessage: { en: 'New message', km: 'សារថ្មី' },

  newSignInTitle: {
    en: 'New sign-in to your account',
    km: 'មានការចូលគណនីរបស់អ្នកថ្មី',
  },
  newSignInBody: {
    en: (device: string) =>
      `${device} signed in. If this wasn't you, sign it out and change your password.`,
    km: (device: string) =>
      `${device} បានចូលគណនីរបស់អ្នក។ ប្រសិនបើមិនមែនជាអ្នកទេ សូមចាកចេញពីឧបករណ៍នោះ ហើយប្តូរពាក្យសម្ងាត់។`,
  },
  aNewDevice: { en: 'A new device', km: 'ឧបករណ៍ថ្មីមួយ' },

  incomingCall: {
    en: (caller: string) => `${caller} is calling`,
    km: (caller: string) => `${caller} កំពុងហៅមក`,
  },
  tapToAnswer: { en: 'Tap to answer', km: 'ចុចដើម្បីឆ្លើយ' },
  missedCall: { en: 'Missed call', km: 'ការហៅដែលខកខាន' },
  missedCallFrom: {
    en: (caller: string) => `${caller} called you`,
    km: (caller: string) => `${caller} បានហៅអ្នក`,
  },

  newListingFrom: {
    en: (owner: string) => `${owner} posted a new listing`,
    km: (owner: string) => `${owner} បានបង្ហោះអចលនទ្រព្យថ្មី`,
  },
  priceDropped: {
    en: (title: string) => `Price dropped: ${title}`,
    km: (title: string) => `តម្លៃបានធ្លាក់ចុះ៖ ${title}`,
  },
  sold: {
    en: (title: string) => `Sold: ${title}`,
    km: (title: string) => `បានលក់៖ ${title}`,
  },
  savedListingSold: {
    en: 'A listing you saved is no longer available.',
    km: 'អចលនទ្រព្យដែលអ្នកបានរក្សាទុក លែងមានទៀតហើយ។',
  },
  newListingInSearch: {
    en: (search: string) => `New listing in "${search}"`,
    km: (search: string) => `អចលនទ្រព្យថ្មីក្នុង "${search}"`,
  },
} as const;

/** The text of [entry] for [locale]. */
export function inLocale<T>(entry: Record<Locale, T>, locale: Locale): T {
  return entry[locale] ?? entry.en;
}
