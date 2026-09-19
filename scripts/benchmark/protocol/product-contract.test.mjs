import assert from 'node:assert/strict'
import test from 'node:test'
import { collectProductContractFingerprint } from './product-contract.mjs'

test('Product Contract Fingerprint reads code/build authority and marks unavailable data explicitly', async () => {
  const fingerprint = await collectProductContractFingerprint()
  assert.equal(fingerprint.dataContractVersion.value, 'v1.61')
  assert.equal(fingerprint.dataContractSchemaVersion.value, 115)
  assert.equal(fingerprint.campSnapshotSchemaVersion.value, 34)
  assert.equal(fingerprint.contextManifestVersion.value, 26)
  assert.equal(fingerprint.contextFormatterVersion.value, 26)
  assert.equal(fingerprint.contextDeliveryProfileVersion.value, 7)
  assert.equal(fingerprint.durableTaskContract.value.version, 3)
  assert.equal(fingerprint.builtInTransportVersion.value, 29)
  assert.equal(fingerprint.acceptedInputAckContract.value.semanticClass, 'accepted_input_only')
  assert.equal(fingerprint.coreExecutableDigest.status, 'unavailable')
  assert.equal(fingerprint.builtInCatalogDigest.status, 'unavailable')
  assert.ok(fingerprint.builtInCatalogDigest.reason.code)
})
