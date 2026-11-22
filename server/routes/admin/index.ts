import type { FastifyInstance } from 'fastify';
import { adminBookingRoutes, type AdminBookingRoutesOptions } from './bookings.js';
import { adminMeetingTypeRoutes, type AdminMeetingTypeRoutesOptions } from './meeting-types.js';

// The admin subtree is one facade for `buildApp()`: the group hides how many
// route modules it has, while the wiring still passes every scenario in.
type AdminRoutesOptions = AdminBookingRoutesOptions & AdminMeetingTypeRoutesOptions;

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: AdminRoutesOptions,
): Promise<void> {
  await app.register(adminMeetingTypeRoutes, {
    createMeetingType: options.createMeetingType,
    listMeetingTypes: options.listMeetingTypes,
    getMeetingType: options.getMeetingType,
  });
  await app.register(adminBookingRoutes, {
    listUpcomingBookings: options.listUpcomingBookings,
    schedule: options.schedule,
  });
}
