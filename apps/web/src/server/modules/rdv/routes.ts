import 'server-only';
import {
  appointmentTypeInput,
  queueInput,
  scheduleExceptionInput,
  scheduleInput,
} from '@medhub/domain';
import { z } from 'zod';
import { clientIp, defineRoute, json } from '../../platform/http';
import {
  addScheduleException,
  getRdvConfig,
  removeScheduleException,
  saveAppointmentType,
  saveQueue,
  saveSchedule,
} from './config';

const client = (request: Request) => ({ ip: clientIp(request) });

export const rdvConfigRoute = defineRoute({
  route: 'schedules.read',
  handler: async ({ ctx }) => json(await getRdvConfig(ctx)),
});

export const queueSaveRoute = defineRoute({
  route: 'queues.save',
  schema: queueInput,
  handler: async ({ request, body, ctx }) => json(await saveQueue(ctx, body, client(request))),
});

export const appointmentTypeSaveRoute = defineRoute({
  route: 'appointment_types.save',
  schema: appointmentTypeInput,
  handler: async ({ request, body, ctx }) =>
    json(await saveAppointmentType(ctx, body, client(request))),
});

export const scheduleSaveRoute = defineRoute({
  route: 'schedules.save',
  schema: scheduleInput,
  handler: async ({ request, body, ctx }) => {
    await saveSchedule(ctx, body, client(request));
    return json({ ok: true });
  },
});

export const scheduleExceptionAddRoute = defineRoute({
  route: 'schedules.exceptions.add',
  schema: scheduleExceptionInput,
  handler: async ({ request, body, ctx }) =>
    json(await addScheduleException(ctx, body, client(request)), { status: 201 }),
});

export const scheduleExceptionRemoveRoute = defineRoute({
  route: 'schedules.exceptions.remove',
  schema: z.object({ id: z.uuid() }),
  handler: async ({ request, body, ctx }) => {
    await removeScheduleException(ctx, body, client(request));
    return json({ ok: true });
  },
});
