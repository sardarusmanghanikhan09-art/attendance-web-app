import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { initReminderListeners, setupReminders, getReminderOwner } from '../utils/reminders';

// Lives inside the router: opens the scan screen when a reminder is tapped,
// and refreshes this week's reminders each time the app starts.
export default function ReminderBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    initReminderListeners(navigate);
    const owner = getReminderOwner();
    if (owner) setupReminders(owner);
  }, [navigate]);
  return null;
}
