import type { RelayAgentActivityAggregateRow } from "@t3tools/contracts/relay";
import {
  sanitizeAgentActivityAggregateRow,
  sanitizeAgentActivityAggregateState,
  truncateText,
  sanitizeDeepLink,
} from "@t3tools/shared/agentActivityPayloads";
import type { ApnsNotificationPayload } from "./apnsDeliveryJobs.ts";

// ApnsClient truncates alert text to the same length as these payloads.
export const MAX_SUMMARY_TEXT_LENGTH = 120;
export { sanitizeAgentActivityAggregateState, truncateText };

export function sanitizeApnsNotificationPayload(
  notification: ApnsNotificationPayload,
): ApnsNotificationPayload {
  return {
    ...notification,
    title: truncateText(notification.title, MAX_SUMMARY_TEXT_LENGTH),
    body: truncateText(notification.body, MAX_SUMMARY_TEXT_LENGTH),
    deepLink: sanitizeDeepLink(notification.deepLink),
  };
}

export function notificationForActivity(
  row: RelayAgentActivityAggregateRow,
): ApnsNotificationPayload {
  const activity = sanitizeAgentActivityAggregateRow(row);
  return sanitizeApnsNotificationPayload({
    title: activity.threadTitle,
    body: `${activity.status}: ${activity.projectTitle}`,
    environmentId: activity.environmentId,
    threadId: activity.threadId,
    deepLink: activity.deepLink,
    phase: activity.phase,
    updatedAt: activity.updatedAt,
  });
}
