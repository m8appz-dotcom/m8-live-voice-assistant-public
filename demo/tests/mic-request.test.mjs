import test from "node:test";
import assert from "node:assert/strict";
import { createMicrophoneRequest } from "../public/mic-request.js";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("double activation acquires one microphone while permission and resume are pending", async () => {
  const permission = deferred(),
    resumed = deferred(),
    stream = {
      getTracks: () => [
        {
          stop() {
            throw Error("Attached stream remains owned by capture");
          },
        },
      ],
    };
  let calls = 0,
    attached = 0;
  const states = [];
  const request = createMicrophoneRequest({
    acquire: () => {
      calls++;
      return permission.promise;
    },
    resume: () => resumed.promise,
    attach: (s) => {
      assert.equal(s, stream);
      attached++;
    },
    isClosed: () => false,
    onError: () => assert.fail("Unexpected error"),
    onPending: (v) => states.push(v),
  });
  const first = request.start();
  await request.start();
  permission.resolve(stream);
  await Promise.resolve();
  await request.start();
  resumed.resolve();
  await first;
  assert.equal(calls, 1);
  assert.equal(attached, 1);
  assert.deepEqual(states, [true, false]);
});

test("closing during acquisition or resume releases the late stream without attaching it", async () => {
  for (const phase of ["permission", "resume"]) {
    const permission = deferred(),
      resumed = deferred();
    let closed = false,
      stops = 0;
    const stream = {
      getTracks: () => [
        {
          stop() {
            stops++;
          },
        },
      ],
    };
    const request = createMicrophoneRequest({
      acquire: () => permission.promise,
      resume: () => resumed.promise,
      attach: () => assert.fail("Closed capture attached"),
      isClosed: () => closed,
      onError: () => assert.fail("Closed capture reported an error"),
      onPending: () => {},
    });
    const pending = request.start();
    if (phase === "resume") {
      permission.resolve(stream);
      await Promise.resolve();
    }
    closed = true;
    request.cancel();
    permission.resolve(stream);
    resumed.resolve();
    await pending;
    assert.equal(stops, 1);
  }
});

test("resume failure releases its stream and permits a later retry", async () => {
  let stops = 0,
    errors = 0,
    calls = 0;
  const request = createMicrophoneRequest({
    acquire: async () => {
      calls++;
      return {
        getTracks: () => [
          {
            stop() {
              stops++;
            },
          },
        ],
      };
    },
    resume: async () => {
      throw Error("Resume failed");
    },
    attach: () => assert.fail("Failed resume attached"),
    isClosed: () => false,
    onError: () => errors++,
    onPending: () => {},
  });
  await request.start();
  await request.start();
  assert.deepEqual({ stops, errors, calls }, { stops: 2, errors: 2, calls: 2 });
});
