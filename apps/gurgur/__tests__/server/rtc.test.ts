import { describe, expect, test } from "bun:test";
import type { RTCPeerConnection } from "werift";
import {
  guardIceUdpSockets,
  prepareMdnsIceDescription,
} from "../../server/src/rtc";

describe("Firefox mDNS ICE candidates", () => {
  test("preserves obfuscated host candidates while leaving ICE open for resolution", () => {
    const description = {
      type: "answer" as const,
      sdp: [
        "v=0",
        "a=candidate:0 1 UDP 2122252543 browser-host.local 54788 typ host",
        "a=candidate:1 1 TCP 2105524479 browser-host.local 9 typ host tcptype active",
        "a=candidate:2 1 UDP 1686052607 198.51.100.8 62000 typ srflx raddr 0.0.0.0 rport 0",
        "a=candidate:3 1 UDP 1677734911 203.0.113.9 3478 typ relay raddr 0.0.0.0 rport 0",
        "a=end-of-candidates",
        "",
      ].join("\r\n"),
    };
    const prepared = prepareMdnsIceDescription(description);
    expect(prepared.sdp).toContain("browser-host.local");
    expect(prepared.sdp).toContain("198.51.100.8 62000 typ srflx");
    expect(prepared.sdp).toContain("203.0.113.9 3478 typ relay");
    expect(prepared.sdp).not.toContain("a=end-of-candidates");
  });

  test("preserves descriptions without mDNS candidates byte-for-byte", () => {
    const description = {
      type: "answer" as const,
      sdp: "v=0\r\na=candidate:0 1 UDP 2122252543 192.0.2.8 54788 typ host\r\n",
    };
    expect(prepareMdnsIceDescription(description)).toEqual(description);
  });
});

describe("werift ICE UDP socket guard", () => {
  test("absorbs unreachable endpoints, reports unexpected errors, and installs once", () => {
    const listeners: Array<(error: NodeJS.ErrnoException) => void> = [];
    const socket = {
      on(_event: "error", listener: (error: NodeJS.ErrnoException) => void) {
        listeners.push(listener);
      },
    };
    const peer = {
      iceTransports: [
        { connection: { protocols: [{ transport: { socket } }] } },
      ],
    } as unknown as RTCPeerConnection;
    const unexpected: NodeJS.ErrnoException[] = [];

    guardIceUdpSockets(peer, (error) => unexpected.push(error));
    guardIceUdpSockets(peer, (error) => unexpected.push(error));
    expect(listeners).toHaveLength(1);
    const listener = listeners[0]!;

    listener(
      Object.assign(new Error("remote closed"), { code: "ECONNREFUSED" }),
    );
    expect(unexpected).toHaveLength(0);

    const programmingError = Object.assign(new Error("bad descriptor"), {
      code: "EBADF",
    });
    listener(programmingError);
    expect(unexpected).toEqual([programmingError]);
  });
});
