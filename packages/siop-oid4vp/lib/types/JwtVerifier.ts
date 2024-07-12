import { calculateJwkThumbprintUri, getDigestAlgorithmFromJwkThumbprintUri } from '../helpers'
import { JwtProtectionMethod, JwtType, parseJWT } from '../helpers/jwtUtils'

import SIOPErrors from './Errors'
import { JWK, JwtHeader, JwtPayload } from './JWT.types'
import { RequestObjectPayload } from './SIOP.types'

interface JwtVerifierBase {
  type: JwtType
  method: JwtProtectionMethod
}

interface DidJwtVerifier extends JwtVerifierBase {
  method: 'did'
  didUrl: string
}

interface X5cJwtVerifier extends JwtVerifierBase {
  method: 'x5c'

  /**
   *
   * Array of base64-encoded certificate strings in the DER-format.
   *
   * The certificate containing the public key corresponding to the key used to digitally sign the JWS MUST be the first certificate.
   */
  x5c: Array<string>

  /**
   * The jwt issuer
   */
  issuer: string
}

interface OpenIdFederationjwtVerifier extends JwtVerifierBase {
  method: 'openid-federation'

  /**
   * The OpenId federation Entity
   */
  entityId: string
}

type JwkJwtVerifier =
  | (JwtVerifierBase & {
      method: 'jwk'
      type: 'id-token'

      jwk: JsonWebKey
      jwkThumbprint: string
    })
  | (JwtVerifierBase & {
      method: 'jwk'
      type: 'request-object' | 'verifier-attestation'

      jwk: JsonWebKey
      jwkThumbprint?: never
    })

interface CustomJwtVerifier extends JwtVerifierBase {
  method: 'custom'
}

export type JwtVerifier = DidJwtVerifier | X5cJwtVerifier | CustomJwtVerifier | JwkJwtVerifier | OpenIdFederationjwtVerifier

export const getDidJwtVerifier = (jwt: { header: JwtHeader; payload: JwtPayload }, options: { type: JwtType }): DidJwtVerifier => {
  const { type } = options
  if (!jwt.header.kid) throw new Error(`${SIOPErrors.INVALID_JWT} Missing kid header.`)

  if (!jwt.header.kid.includes('#')) {
    throw new Error(`${SIOPErrors.INVALID_JWT}. '${type}' contains an invalid kid header.`)
  }
  return { method: 'did', didUrl: jwt.header.kid, type: type }
}

export const getX5cVerifier = (jwt: { header: JwtHeader; payload: JwtPayload }, options: { type: JwtType }): X5cJwtVerifier => {
  const { type } = options
  if (!jwt.header.x5c) throw new Error(`${SIOPErrors.INVALID_JWT} Missing x5c header.`)

  if (!Array.isArray(jwt.header.x5c) || jwt.header.x5c.length === 0 || !jwt.header.x5c.every((cert) => typeof cert === 'string')) {
    throw new Error(`${SIOPErrors.INVALID_JWT}. '${type}' contains an invalid x5c header.`)
  }
  return { method: 'x5c', x5c: jwt.header.x5c, issuer: jwt.payload.iss, type: type }
}

export const getJwkVerifier = async (jwt: { header: JwtHeader; payload: JwtPayload }, options: { type: JwtType }): Promise<JwkJwtVerifier> => {
  const { type } = options
  if (!jwt.header.jwk) throw new Error(`${SIOPErrors.INVALID_JWT} Missing jwk header.`)

  if (typeof jwt.header.jwk !== 'object') {
    throw new Error(`${SIOPErrors.INVALID_JWT} '${type}' contains an invalid jwk header.`)
  }
  if (type !== 'id-token') {
    // Users need to check if the iss claim matches an entity they trust
    // for type === 'verifier-attestation'
    return { method: 'jwk', type, jwk: jwt.header.jwk }
  }

  if (typeof jwt.payload.sub_jwk !== 'string') {
    throw new Error(`${SIOPErrors.INVALID_JWT} '${type}' missing sub_jwk claim.`)
  }

  const jwkThumbPrintUri = jwt.payload.sub_jwk
  const digestAlgorithm = await getDigestAlgorithmFromJwkThumbprintUri(jwkThumbPrintUri)
  const selfComputedJwkThumbPrintUri = await calculateJwkThumbprintUri(jwt.header.jwk as JWK, digestAlgorithm)

  if (selfComputedJwkThumbPrintUri !== jwkThumbPrintUri) {
    throw new Error(`${SIOPErrors.INVALID_JWT} '${type}' contains an invalid sub_jwk claim.`)
  }

  return { method: 'jwk', type, jwk: jwt.header.jwk, jwkThumbprint: jwt.payload.sub_jwk }
}

export const getJwtVerifierWithContext = async (
  jwt: { header: JwtHeader; payload: JwtPayload },
  options: { type: JwtType },
): Promise<JwtVerifier> => {
  const { header, payload } = jwt

  if (header.kid?.startsWith('did:')) return getDidJwtVerifier({ header, payload }, options)
  else if (jwt.header.x5c) return getX5cVerifier({ header, payload }, options)
  else if (jwt.header.jwk) return getJwkVerifier({ header, payload }, options)

  return { method: 'custom', type: options.type }
}

export type VerifyJwtCallback = (jwtVerifier: JwtVerifier, jwt: { header: JwtHeader; payload: JwtPayload; raw: string }) => Promise<boolean>

export const getRequestObjectJwtVerifier = async (
  jwt: { header: JwtHeader; payload: RequestObjectPayload },
  options: { raw: string },
): Promise<JwtVerifier> => {
  const type = 'request-object'

  const clientIdScheme = jwt.payload.client_id_scheme
  const clientId = jwt.payload.client_id

  if (!clientIdScheme) {
    return getJwtVerifierWithContext(jwt, { type })
  }

  if (clientIdScheme === 'did') {
    return getDidJwtVerifier(jwt, { type })
  } else if (clientIdScheme === 'pre-registered') {
    // All validations must be done manually
    // The Verifier metadata is obtained using [RFC7591] or through out-of-band mechanisms.
    return getJwtVerifierWithContext(jwt, { type })
  } else if (clientIdScheme === 'x509_san_dns' || clientIdScheme === 'x509_san_uri') {
    return getX5cVerifier(jwt, { type })
  } else if (clientIdScheme === 'redirect_uri') {
    if (jwt.payload.redirect_uri && jwt.payload.redirect_uri !== clientId) {
      throw new Error(SIOPErrors.INVALID_CLIENT_ID_MUST_MATCH_REDIRECT_URI)
    }
    if (options.raw.split('.').length > 2) {
      throw new Error(`${SIOPErrors.INVALID_JWT} '${type}' JWT must not not be signed.`)
    }
    return getJwtVerifierWithContext(jwt, { type })
  } else if (clientIdScheme === 'verifier_attestation') {
    const verifierAttestationSubtype = 'verifier-attestation+jwt'
    if (!jwt.header.jwt) {
      throw new Error(SIOPErrors.MISSING_ATTESTATION_JWT)
    }
    // TODO: is this correct? not 100% sure based on the spec
    if (jwt.header.typ !== verifierAttestationSubtype) {
      throw new Error(SIOPErrors.MISSING_ATTESTATION_JWT_TYP)
    }

    const attestationJwt = jwt.header.jwt
    const { header: attestationHeader, payload: attestationPayload } = parseJWT(attestationJwt)

    if (
      attestationHeader.typ !== verifierAttestationSubtype ||
      attestationPayload.sub !== clientId ||
      !attestationPayload.iss ||
      typeof attestationPayload.iss !== 'string' ||
      !attestationPayload.exp ||
      typeof attestationPayload.exp !== 'number' ||
      typeof attestationPayload.cnf !== 'object' ||
      typeof attestationPayload.cnf['jwk'] !== 'object'
    ) {
      throw new Error(SIOPErrors.BAD_VERIFIER_ATTESTATION)
    }

    if (attestationPayload.redirect_uris) {
      if (
        !Array.isArray(attestationPayload.redirect_uris) ||
        attestationPayload.redirect_uris.some((value) => typeof value !== 'string') ||
        !jwt.payload.redirect_uri ||
        !attestationPayload.redirect_uris.includes(jwt.payload.redirect_uri)
      ) {
        throw new Error(SIOPErrors.BAD_VERIFIER_ATTESTATION_REDIRECT_URIS)
      }
    }

    // The iss claim value of the Verifier Attestation JWT MUST identify a party the Wallet trusts for issuing Verifier Attestation JWTs.
    // If the Wallet cannot establish trust, it MUST refuse the request.
    return { method: 'jwk', type, jwk: attestationPayload.cnf['jwk'] as JWK }
  } else if (clientIdScheme === 'entity_id') {
    if (!clientId.startsWith('http')) {
      throw new Error(SIOPErrors.INVALID_REQUEST_OBJECT_ENTITY_ID_SCHEME_CLIENT_ID)
    }

    return { method: 'openid-federation', type, entityId: clientId }
  }

  throw new Error(SIOPErrors.INVALID_CLIENT_ID_SCHEME)
}