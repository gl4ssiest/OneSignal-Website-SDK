import "../../support/polyfills/polyfills";
import test, { TestContext, Context } from "ava";
import Database from "../../../src/services/Database";
import Macros from "../../support/tester/Macros";
import {TestEnvironment, BrowserUserAgent} from "../../support/sdk/TestEnvironment";
import OneSignal from "../../../src/OneSignal";
import { Subscription } from '../../../src/models/Subscription';

import { InvalidArgumentError } from '../../../src/errors/InvalidArgumentError';
import nock from 'nock';
import { AppConfig } from '../../../src/models/AppConfig';
import { EmailProfile } from '../../../src/models/EmailProfile';
import Random from "../../support/tester/Random";
import Environment from '../../../src/Environment';
import { setUserAgent } from "../../support/tester/browser";

test("setEmail should reject an empty or invalid emails", async t => {
    await TestEnvironment.initialize();
  try {
    await OneSignal.setEmail(undefined);
    t.fail('expected exception not caught');
  } catch (e) {
    t.truthy(e instanceof InvalidArgumentError);
  }

  try {
    await OneSignal.setEmail(null);
    t.fail('expected exception not caught');
  } catch (e) {
    t.truthy(e instanceof InvalidArgumentError);
  }

  try {
    await OneSignal.setEmail(null);
    t.fail('expected exception not caught');
  } catch (e) {
    t.truthy(e instanceof InvalidArgumentError);
  }

  try {
    await OneSignal.setEmail("test@@example.com");
    t.fail('expected exception not caught');
  } catch (e) {
    t.truthy(e instanceof InvalidArgumentError);
  }
});

test("setEmail should not accept an email auth SHA-256 hex hash not 64 characters long", async t => {
  await TestEnvironment.initialize();
  try {
    await OneSignal.setEmail("test@example.com", {
      emailAuthHash: "12345"
    });
    t.fail('expected exception not caught');
  } catch (e) {
    t.truthy(e instanceof InvalidArgumentError);
  }
});

/*
 * Test Case | Description
 * -----------------------
 * No push subscription, no email, first setEmail call
 * No push subscription, existing identical email, refreshing setEmail call
 * No push subscription, existing different email, updating email
 * Existing push subscription, no email, first setEmail call
 * Existing push subscription, existing identical email, refreshing setEmail call
 * Existing push subscription, existing different email, updating email
 *
 * ---
 *
 * ..., existing email (identical or not), emailAuthHash --> makes a PUT call instead of POST
 */

async function expectEmailRecordCreationRequest(
  t: TestContext & Context<any>,
  emailAddress: string,
  pushDevicePlayerId: string,
  emailAuthHash: string,
  newCreatedEmailId: string
) {
  console.log("Navigator:", navigator);
  console.log("window.Navigator:", window.navigator);
  nock('https://onesignal.com')
    .post(`/api/v1/players`)
    .reply(200, (uri, requestBody) => {
      const sameValues = {
        app_id: undefined,
        identifier: emailAddress,
        device_player_id: pushDevicePlayerId ? pushDevicePlayerId : undefined,
        email_auth_hash: emailAuthHash ? emailAuthHash : undefined
      };
      const anyValues = [
        "device_type",
        "language",
        "timezone",
        "device_os",
        "sdk",
        "delivery_platform",
        "browser_name",
        "browser_version",
        "operating_system",
        "operating_system_version",
        "device_platform",
        "device_model",
      ];
      const parsedRequestBody = JSON.parse(requestBody);
      for (const sameValueKey of Object.keys(sameValues)) {
        t.deepEqual(parsedRequestBody[sameValueKey], sameValues[sameValueKey]);
      }
      for (const anyValueKey of anyValues) {
        t.not(parsedRequestBody[anyValueKey], undefined);
      }
      return { "success":true, "id": newCreatedEmailId };
    });
}

async function expectEmailRecordUpdateRequest(
  t: TestContext & Context<any>,
  emailId: string,
  emailAddress: string,
  pushDevicePlayerId: string,
  emailAuthHash: string,
  newUpdatedEmailId: string
) {
  nock('https://onesignal.com')
    .put(`/api/v1/players/${emailId}`)
    .reply(200, (uri, requestBody) => {
      const sameValues = {
        app_id: undefined,
        identifier: emailAddress,
        device_player_id: pushDevicePlayerId ? pushDevicePlayerId : undefined,
        email_auth_hash: emailAuthHash ? emailAuthHash : undefined
      };
      const anyValues = [
        "device_type",
        "language",
        "timezone",
        "device_os",
        "sdk",
        "delivery_platform",
        "browser_name",
        "browser_version",
        "operating_system",
        "operating_system_version",
        "device_platform",
        "device_model",
      ];
      const parsedRequestBody = JSON.parse(requestBody);
      for (const sameValueKey of Object.keys(sameValues)) {
        t.deepEqual(parsedRequestBody[sameValueKey], sameValues[sameValueKey]);
      }
      for (const anyValueKey of anyValues) {
        t.not(parsedRequestBody[anyValueKey], undefined);
      }
      return { "success":true, "id": newUpdatedEmailId };
    });
}

async function expectPushRecordUpdateRequest(
  t: TestContext & Context<any>,
  pushDevicePlayerId: string,
  newEmailId: string,
  emailAddress: string,
  newUpdatedPlayerId: string
) {
  nock('https://onesignal.com')
    .put(`/api/v1/players/${pushDevicePlayerId}`)
    .reply(200, (uri, requestBody) => {
      t.deepEqual(
        requestBody,
        JSON.stringify({
          app_id: null,
          parent_player_id: newEmailId ? newEmailId : undefined,
          email: emailAddress,
        })
      );
      return { "success":true, "id": newUpdatedPlayerId };
    });
}

interface SetEmailTestData {
  existingEmailAddress: string;
  newEmailAddress: string; /* Email address used for setEmail */
  existingPushDeviceId: string;
  emailAuthHash: string;
  existingEmailId: string;
  requireEmailAuth: boolean;
  newEmailId: string; /* Returned by the create or update email record call */
}

async function setEmailTest(
  t: TestContext & Context<any>,
  testData: SetEmailTestData
) {
  await TestEnvironment.initialize();
  setUserAgent(BrowserUserAgent.FirefoxMacSupported);

  if (testData.existingEmailAddress) {
    const emailProfile = await Database.getEmailProfile();
    emailProfile.emailAddress = testData.existingEmailAddress;
    await Database.setEmailProfile(emailProfile);
  }

  /* If an existing push device ID is set, create a fake one here */
  if (testData.existingPushDeviceId) {
    const subscription = await Database.getSubscription();
    subscription.deviceId = testData.existingPushDeviceId;
    await Database.setSubscription(subscription);
  }

  if (testData.requireEmailAuth) {
    const appConfig = await Database.getAppConfig();
    appConfig.emailAuthRequired = true;
    await Database.setAppConfig(appConfig);
  }

  /* If test data has an email auth hash, fake the config parameter */
  if (testData.emailAuthHash) {
    const emailProfile = await Database.getEmailProfile();
    emailProfile.emailAuthHash = testData.emailAuthHash;
    await Database.setEmailProfile(emailProfile);
  }

  if (testData.existingEmailId) {
    const emailProfile = await Database.getEmailProfile();
    emailProfile.emailId = testData.existingEmailId;
    await Database.setEmailProfile(emailProfile);
  }

  // Mock the one or two requests we expect to occur
  const isUpdateRequest = testData.emailAuthHash && testData.existingEmailId;

  if (isUpdateRequest) {
    // Means we're making a PUT call to /players/<id>
    expectEmailRecordUpdateRequest(
      t,
      testData.existingEmailId,
      testData.newEmailAddress,
      testData.existingPushDeviceId,
      testData.emailAuthHash,
      testData.newEmailId
    );
  } else {
    // Means we're making a POST call to /players
    expectEmailRecordCreationRequest(
      t,
      testData.newEmailAddress,
      testData.existingPushDeviceId,
      testData.emailAuthHash,
      testData.newEmailId
    );
  }

  if (
      testData.existingPushDeviceId &&
      !(
        testData.existingEmailId === testData.newEmailId &&
        testData.existingEmailAddress === testData.newEmailAddress
      )
    ) {
    /*
      Expect a second call to be made if:
        - We're subscribed to web push (existing player ID)
        - The email ID or plain text email address changes from what we have saved, or if neither was ever saved
    */
    expectPushRecordUpdateRequest(
      t,
      testData.existingPushDeviceId,
      testData.newEmailId,
      testData.newEmailAddress,
      Random.getRandomUuid(),
    );
  }

  await OneSignal.setEmail(
    testData.newEmailAddress,
    testData.emailAuthHash ?
      { emailAuthHash: testData.emailAuthHash } :
      undefined
  );

  const { deviceId: finalPushDeviceId } = await Database.getSubscription();
  const finalEmailProfile = await Database.getEmailProfile();

  t.deepEqual(finalPushDeviceId, testData.existingPushDeviceId ? testData.existingPushDeviceId : null);
  t.deepEqual(finalEmailProfile.emailAddress, testData.newEmailAddress);
  t.deepEqual(finalEmailProfile.emailAuthHash, testData.emailAuthHash);
  t.deepEqual(finalEmailProfile.emailId, testData.newEmailId);
}

test("No push subscription, no email, first setEmail call", async t => {
  const testData: SetEmailTestData = {
    existingEmailAddress: null,
    newEmailAddress: "test@example.com",
    existingPushDeviceId: null,
    emailAuthHash: undefined,
    existingEmailId: null,
    requireEmailAuth: false,
    newEmailId: Random.getRandomUuid()
  };
  await setEmailTest(t, testData);
});

test("No push subscription, existing identical email, refreshing setEmail call", async t => {
  const emailId = Random.getRandomUuid();
  const testData: SetEmailTestData = {
    existingEmailAddress: "test@example.com",
    newEmailAddress: "test@example.com",
    existingPushDeviceId: null,
    emailAuthHash: undefined,
    existingEmailId: emailId,
    requireEmailAuth: false,
    newEmailId: emailId
  };
  await setEmailTest(t, testData);
});

test("No push subscription, existing different email, updating setEmail call", async t => {
  const testData: SetEmailTestData = {
    existingEmailAddress: "existing-different-email-address@example.com",
    newEmailAddress: "test@example.com",
    existingPushDeviceId: null,
    emailAuthHash: undefined,
    existingEmailId: Random.getRandomUuid(),
    requireEmailAuth: false,
    newEmailId: Random.getRandomUuid()
  };
  await setEmailTest(t, testData);
});

test("Existing push subscription, no email, first setEmail call", async t => {
  const testData: SetEmailTestData = {
    existingEmailAddress: null,
    newEmailAddress: "test@example.com",
    existingPushDeviceId: Random.getRandomUuid(),
    emailAuthHash: undefined,
    existingEmailId: null,
    requireEmailAuth: false,
    newEmailId: Random.getRandomUuid()
  };
  await setEmailTest(t, testData);
});

test("Existing push subscription, existing identical email, refreshing setEmail call", async t => {
  const emailId = Random.getRandomUuid();
  const testData: SetEmailTestData = {
    existingEmailAddress: "test@example.com",
    newEmailAddress: "test@example.com",
    existingPushDeviceId: Random.getRandomUuid(),
    emailAuthHash: undefined,
    existingEmailId: emailId,
    requireEmailAuth: false,
    newEmailId: emailId
  };
  await setEmailTest(t, testData);
});


test("Existing push subscription, existing different email, updating setEmail call", async t => {
  const testData: SetEmailTestData = {
    existingEmailAddress: "existing-different-email@example.com",
    newEmailAddress: "test@example.com",
    existingPushDeviceId: Random.getRandomUuid(),
    emailAuthHash: undefined,
    existingEmailId: Random.getRandomUuid(),
    requireEmailAuth: false,
    newEmailId: Random.getRandomUuid(),
  };
  await setEmailTest(t, testData);
});

test(
  "Existing push subscription, existing identical email, with emailAuthHash, refreshing setEmail call",
  async t => {
    const testData: SetEmailTestData = {
      existingEmailAddress: "existing-different-email@example.com",
      newEmailAddress: "test@example.com",
      existingPushDeviceId: Random.getRandomUuid(),
      emailAuthHash: "432B5BE752724550952437FAED4C8E2798E9D0AF7AACEFE73DEA923A14B94799",
      existingEmailId: Random.getRandomUuid(),
      requireEmailAuth: true,
      newEmailId: Random.getRandomUuid(),
    };
    await setEmailTest(t, testData);
});

test(
  "require email auth without emailAuthHash setEmail call",
  async t => {
    const testData: SetEmailTestData = {
      existingEmailAddress: "existing-different-email@example.com",
      newEmailAddress: "test@example.com",
      existingPushDeviceId: Random.getRandomUuid(),
      emailAuthHash: undefined,
      existingEmailId: Random.getRandomUuid(),
      requireEmailAuth: true,
      newEmailId: Random.getRandomUuid(),
    };

    try {
      await OneSignal.setEmail(null);
      t.fail('expected exception not caught');
    } catch (e) {
      t.truthy(e instanceof InvalidArgumentError);
    }
});
