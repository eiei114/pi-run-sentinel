import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { startRpcProcess } from "./pi-rpc-smoke.mjs";

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
  }

  kill() {
    this.emit("close", null, "SIGTERM");
  }
}

test("malformed RPC output rejects a request with an active waiter", async () => {
  const child = new FakeChildProcess();
  const rpc = startRpcProcess("", "", () => child);
  const request = rpc.request("active-request", { type: "prompt", message: "test" });

  child.stdout.write("{malformed JSON}\n");
  child.stdout.write(`${JSON.stringify({
    type: "response",
    id: "active-request",
    success: true,
  })}\n`);

  await assert.rejects(request, /Pi emitted invalid RPC JSON/);
  await rpc.stopAfterFailure();
});
