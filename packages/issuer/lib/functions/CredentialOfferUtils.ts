import {
  CredentialIssuerMetadata,
  CredentialIssuerMetadataOptsV1_0_13,
  CredentialOfferPayloadV1_0_13,
  CredentialOfferSession,
  CredentialOfferV1_0_13,
  Grant,
  PIN_VALIDATION_ERROR,
  TxCode,
  UniformCredentialOffer,
} from '@sphereon/oid4vci-common'
import { v4 as uuidv4 } from 'uuid'

export function createCredentialOfferObject(
  issuerMetadata?: CredentialIssuerMetadataOptsV1_0_13,
  // todo: probably it's wise to create another builder for CredentialOfferPayload that will generate different kinds of CredentialOfferPayload
  opts?: {
    credentialOffer?: CredentialOfferPayloadV1_0_13
    credentialOfferUri?: string
    scheme?: string
    baseUri?: string
    issuerState?: string
    txCode?: TxCode
    preAuthorizedCode?: string
  },
): CredentialOfferV1_0_13 & { scheme: string; grants: Grant; baseUri: string } {
  if (!issuerMetadata && !opts?.credentialOffer && !opts?.credentialOfferUri) {
    throw new Error('You have to provide issuerMetadata or credentialOffer object for creating a deeplink')
  }

  const scheme = opts?.scheme?.replace('://', '') ?? (opts?.baseUri?.includes('://') ? opts.baseUri.split('://')[0] : 'openid-credential-offer')
  let baseUri: string
  if (opts?.baseUri) {
    baseUri = opts.baseUri
  } else if (scheme.startsWith('http')) {
    if (issuerMetadata?.credential_issuer) {
      baseUri = issuerMetadata?.credential_issuer
      if (!baseUri.startsWith(`${scheme}://`)) {
        throw Error(`scheme ${scheme} is different from base uri ${baseUri}`)
      }
    } else {
      throw Error(`A '${scheme}' scheme requires a URI to be present as baseUri`)
    }
  } else {
    baseUri = ''
  }
  baseUri = baseUri.replace(`${scheme}://`, '')

  const credential_offer_uri = opts?.credentialOfferUri ? `${scheme}://${baseUri}?credential_offer_uri=${opts?.credentialOfferUri}` : undefined
  let credential_offer: CredentialOfferPayloadV1_0_13
  if (opts?.credentialOffer) {
    credential_offer = {
      ...opts.credentialOffer,
    }
  } else {
    if (!issuerMetadata?.credential_configurations_supported) {
      throw new Error('credential_configurations_supported is mandatory in the metadata')
    }
    credential_offer = {
      credential_issuer: issuerMetadata?.credential_issuer,
      credential_configuration_ids: Object.keys(issuerMetadata?.credential_configurations_supported),
    }
  }
  if (!credential_offer.grants) {
    credential_offer.grants = {}
  }
  if (opts?.preAuthorizedCode) {
    credential_offer.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code'] = {
      'pre-authorized_code': opts.preAuthorizedCode,
      tx_code: opts.txCode,
    }
  } else if (!credential_offer.grants?.authorization_code?.issuer_state) {
    credential_offer.grants = {
      authorization_code: {
        issuer_state: opts?.issuerState ?? uuidv4(),
      },
    }
  }
  // todo: check payload against issuer metadata. Especially strings in the credentials array: When processing, the Wallet MUST resolve this string value to the respective object.

  if (!credential_offer.grants) {
    credential_offer.grants = {}
  }
  if (opts?.preAuthorizedCode) {
    credential_offer.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code'] = {
      'pre-authorized_code': opts.preAuthorizedCode,
      tx_code: opts.txCode,
    }
  } else if (!credential_offer.grants?.authorization_code?.issuer_state) {
    credential_offer.grants = {
      authorization_code: {
        issuer_state: opts?.issuerState ?? uuidv4(),
      },
    }
  }
  return { credential_offer, credential_offer_uri, scheme, baseUri, grants: credential_offer.grants }
}

export function createCredentialOfferURIFromObject(
  credentialOffer: (CredentialOfferV1_0_13 | UniformCredentialOffer) & { scheme?: string; baseUri?: string; grant?: Grant },
  opts?: { scheme?: string; baseUri?: string },
) {
  const scheme = opts?.scheme?.replace('://', '') ?? credentialOffer?.scheme?.replace('://', '') ?? 'openid-credential-offer'
  let baseUri = opts?.baseUri ?? credentialOffer?.baseUri ?? ''
  if (baseUri.includes('://')) {
    baseUri = baseUri.split('://')[1]
  }
  if (scheme.startsWith('http') && baseUri === '') {
    throw Error(`Cannot use scheme '${scheme}' without providing a baseUri value`)
  }
  if (credentialOffer.credential_offer_uri) {
    if (credentialOffer.credential_offer_uri.includes('credential_offer_uri=')) {
      // discard the scheme. Apparently a URI is set and it already contains the actual uri, so assume that takes priority
      return credentialOffer.credential_offer_uri
    }
    return `${scheme}://${baseUri}?credential_offer_uri=${credentialOffer.credential_offer_uri}`
  }
  return `${scheme}://${baseUri}?credential_offer=${encodeURIComponent(JSON.stringify(credentialOffer.credential_offer))}`
}

export function createCredentialOfferURI(
  issuerMetadata?: CredentialIssuerMetadata,
  // todo: probably it's wise to create another builder for CredentialOfferPayload that will generate different kinds of CredentialOfferPayload
  opts?: {
    state?: string
    credentialOffer?: CredentialOfferPayloadV1_0_13
    credentialOfferUri?: string
    scheme?: string
    preAuthorizedCode?: string
    userPinRequired?: boolean
  },
): string {
  const credentialOffer = createCredentialOfferObject(issuerMetadata, opts)
  return createCredentialOfferURIFromObject(credentialOffer, opts)
}

export const isPreAuthorizedCodeExpired = (state: CredentialOfferSession, expirationDurationInSeconds: number) => {
  const now = +new Date()
  const expirationTime = state.createdAt + expirationDurationInSeconds * 1000
  return now >= expirationTime
}

export const assertValidPinNumber = (pin?: string) => {
  if (pin && !/[0-9{,8}]/.test(pin)) {
    throw Error(PIN_VALIDATION_ERROR)
  }
}
