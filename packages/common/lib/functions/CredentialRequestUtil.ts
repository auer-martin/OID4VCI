import { CredentialRequestV1_0_08, OpenId4VCIVersion, UniformCredentialRequest } from '../types';

import { getFormatForVersion } from './FormatUtils';

export function getTypesFromRequest(credentialRequest: UniformCredentialRequest, opts?: { filterVerifiableCredential: boolean }) {
  let types: string[] = [];
  if (credentialRequest.format === 'jwt_vc_json' || credentialRequest.format === 'jwt_vc') {
    types = credentialRequest.types;
  } else if (credentialRequest.format === 'jwt_vc_json-ld' || credentialRequest.format === 'ldp_vc') {
    types = credentialRequest.credential_definition.types;
  } else if (credentialRequest.format === 'vc+sd-jwt') {
    types = [credentialRequest.credential_definition.vct];
  }

  if (!types || types.length === 0) {
    throw Error('Could not deduce types from credential request');
  }
  if (opts?.filterVerifiableCredential) {
    return types.filter((type) => type !== 'VerifiableCredential');
  }
  return types;
}

export function getCredentialRequestForVersion(
  credentialRequest: UniformCredentialRequest,
  version: OpenId4VCIVersion,
): UniformCredentialRequest | CredentialRequestV1_0_08 {
  if (version === OpenId4VCIVersion.VER_1_0_08) {
    const draft8Format = getFormatForVersion(credentialRequest.format, version);
    const types = getTypesFromRequest(credentialRequest, { filterVerifiableCredential: true });

    return {
      format: draft8Format,
      proof: credentialRequest.proof,
      type: types[0],
    } satisfies CredentialRequestV1_0_08;
  }

  return credentialRequest;
}
