export interface IBooking {
  userId: string;
  clientId: string;
  clientName: string;
  serviceId: string;
  clientEmail: string;
  startTime: Date;
  endTime: Date;
  date: string;
  status: string;
}
