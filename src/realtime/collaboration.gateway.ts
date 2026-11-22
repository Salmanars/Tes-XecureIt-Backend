import { randomUUID } from "node:crypto";
import type { Response } from "express";

export type CollaborationAction =
  | "opened"
  | "active"
  | "left"
  | "editing"
  | "document.updated"
  | "document.version.created"
  | "document.verified"
  | "document.rejected"
  | "document.revoked"
  | "document.deleted";

export type CollaborationEventType = "presence" | "activity" | "access";

export interface Collaborator {
  id: string;
  name: string;
}

interface CollaborationEvent {
  id: string;
  type: CollaborationEventType;
  documentId: string;
  action: CollaborationAction | "revoked";
  user: Collaborator;
  occurredAt: string;
}

interface Subscriber {
  id: string;
  documentId: string;
  user: Collaborator;
  response: Response;
  pendingFrames: string[];
  onDrain: () => void;
  onClose: () => void;
  onError: () => void;
  closed: boolean;
}

interface Room {
  subscribers: Map<string, Subscriber>;
  members: Map<string, { user: Collaborator; connections: number }>;
}

const rooms = new Map<string, Room>();
const MAX_PENDING_FRAMES = 64;
const HEARTBEAT_INTERVAL_MS = 25_000;
let heartbeat: NodeJS.Timeout | undefined;

function createEvent(
  documentId: string,
  type: CollaborationEventType,
  action: CollaborationEvent["action"],
  user: Collaborator,
): CollaborationEvent {
  return {
    id: randomUUID(),
    type,
    documentId,
    action,
    user,
    occurredAt: new Date().toISOString(),
  };
}

function encodeEvent(event: CollaborationEvent): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}

function flushPendingFrames(subscriber: Subscriber): void {
  const { response } = subscriber;
  while (
    !subscriber.closed &&
    !response.destroyed &&
    !response.writableEnded &&
    !response.writableNeedDrain &&
    subscriber.pendingFrames.length > 0
  ) {
    const frame = subscriber.pendingFrames.shift();
    if (frame !== undefined && !response.write(frame)) {
      return;
    }
  }
}

function enqueueFrame(subscriber: Subscriber, frame: string): void {
  if (subscriber.closed || subscriber.response.destroyed || subscriber.response.writableEnded) {
    return;
  }

  if (subscriber.pendingFrames.length >= MAX_PENDING_FRAMES) {
    subscriber.response.end();
    return;
  }

  subscriber.pendingFrames.push(frame);
  flushPendingFrames(subscriber);
}

function broadcastEvent(documentId: string, event: CollaborationEvent): void {
  const room = rooms.get(documentId);
  if (!room) {
    return;
  }

  const frame = encodeEvent(event);
  for (const subscriber of room.subscribers.values()) {
    enqueueFrame(subscriber, frame);
  }
}

function stopHeartbeatIfIdle(): void {
  if (rooms.size > 0 || !heartbeat) {
    return;
  }

  clearInterval(heartbeat);
  heartbeat = undefined;
}

function startHeartbeat(): void {
  if (heartbeat) {
    return;
  }

  heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const subscriber of room.subscribers.values()) {
        enqueueFrame(subscriber, ": keep-alive\n\n");
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
}

function cleanupSubscriber(subscriber: Subscriber): void {
  if (subscriber.closed) {
    return;
  }
  subscriber.closed = true;
  subscriber.response.off("drain", subscriber.onDrain);
  subscriber.response.off("close", subscriber.onClose);
  subscriber.response.off("error", subscriber.onError);

  const room = rooms.get(subscriber.documentId);
  if (!room) {
    stopHeartbeatIfIdle();
    return;
  }

  room.subscribers.delete(subscriber.id);
  const member = room.members.get(subscriber.user.id);
  if (member) {
    member.connections -= 1;
    if (member.connections <= 0) {
      room.members.delete(subscriber.user.id);
      broadcastEvent(
        subscriber.documentId,
        createEvent(
          subscriber.documentId,
          "presence",
          "left",
          subscriber.user,
        ),
      );
    }
  }

  if (room.subscribers.size === 0) {
    rooms.delete(subscriber.documentId);
  }
  stopHeartbeatIfIdle();
}

function closeWithEvent(subscriber: Subscriber, event: CollaborationEvent): void {
  if (subscriber.closed || subscriber.response.destroyed || subscriber.response.writableEnded) {
    cleanupSubscriber(subscriber);
    return;
  }

  subscriber.pendingFrames.length = 0;
  subscriber.response.end(encodeEvent(event));
  cleanupSubscriber(subscriber);
}

export function subscribeToDocumentEvents(
  documentId: string,
  user: Collaborator,
  response: Response,
): () => void {
  if (response.destroyed || response.writableEnded) {
    return () => undefined;
  }

  let room = rooms.get(documentId);
  if (!room) {
    room = { subscribers: new Map(), members: new Map() };
    rooms.set(documentId, room);
  }

  const subscriberId = randomUUID();
  const subscriber: Subscriber = {
    id: subscriberId,
    documentId,
    user,
    response,
    pendingFrames: [],
    onDrain: () => flushPendingFrames(subscriber),
    onClose: () => cleanupSubscriber(subscriber),
    onError: () => cleanupSubscriber(subscriber),
    closed: false,
  };
  room.subscribers.set(subscriberId, subscriber);
  response.on("drain", subscriber.onDrain);
  response.once("close", subscriber.onClose);
  response.once("error", subscriber.onError);

  const member = room.members.get(user.id);
  if (member) {
    member.connections += 1;
    member.user = user;
    broadcastEvent(
      documentId,
      createEvent(documentId, "presence", "active", user),
    );
  } else {
    room.members.set(user.id, { user, connections: 1 });
    broadcastEvent(
      documentId,
      createEvent(documentId, "presence", "opened", user),
    );
    broadcastEvent(
      documentId,
      createEvent(documentId, "presence", "active", user),
    );
  }

  response.write("retry: 5000\n\n");
  startHeartbeat();
  return () => cleanupSubscriber(subscriber);
}

export function publishDocumentActivity(
  documentId: string,
  userId: string,
  action: Exclude<CollaborationAction, "opened" | "left" | "document.deleted">,
  userName?: string,
): void {
  const room = rooms.get(documentId);
  if (!room) {
    return;
  }

  const user = room.members.get(userId)?.user ?? {
    id: userId,
    name: userName ?? userId,
  };
  broadcastEvent(
    documentId,
    createEvent(documentId, "activity", action, user),
  );
}

export function closeDocumentEventStreams(
  documentId: string,
  actorId: string,
): void {
  const room = rooms.get(documentId);
  if (!room) {
    return;
  }

  const event = createEvent(documentId, "activity", "document.deleted", {
    id: actorId,
    name: room.members.get(actorId)?.user.name ?? actorId,
  });
  for (const subscriber of [...room.subscribers.values()]) {
    closeWithEvent(subscriber, event);
  }
}

export function closeUserDocumentEventStreams(
  documentId: string,
  userId: string,
): void {
  const room = rooms.get(documentId);
  if (!room) {
    return;
  }

  const event = createEvent(
    documentId,
    "access",
    "revoked",
    room.members.get(userId)?.user ?? { id: userId, name: userId },
  );
  for (const subscriber of [...room.subscribers.values()]) {
    if (subscriber.user.id === userId) {
      closeWithEvent(subscriber, event);
    }
  }
}

export function activeDocumentStreamCount(documentId: string): number {
  return rooms.get(documentId)?.subscribers.size ?? 0;
}
