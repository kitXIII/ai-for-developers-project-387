import type { Booking as BookingResponse } from '@app/api/types';
import type { Booking } from '../../models/booking.js';
import type { Schedule } from '../../models/schedule.js';
import { formatMoment } from '../../shared/moment.js';

// The contract shape is assembled here, in the only layer that knows the
// `+03:00` moment format (ADR 0004). The guest and admin adapters import the
// same function: two adapters of one entity do not duplicate the mapping.
export function toContractBooking(
  { id, meetingTypeId, meetingTypeName, guestName, startMs, endMs }: Booking,
  schedule: Schedule,
): BookingResponse {
  return {
    id,
    meetingTypeId,
    meetingTypeName,
    guestName,
    start: formatMoment(startMs, schedule),
    end: formatMoment(endMs, schedule),
  };
}
