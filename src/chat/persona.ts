const FIRST = [
  'John', 'Michael', 'David', 'James', 'Robert', 'Daniel', 'Matthew', 'Andrew', 'Ryan', 'Kevin',
  'Brian', 'Eric', 'Jason', 'Steven', 'Thomas', 'Sarah', 'Emily', 'Jessica', 'Megan', 'Laura',
  'Rachel', 'Amanda', 'Nicole', 'Hannah', 'Olivia', 'Karen', 'Lisa', 'Natalie', 'Chris', 'Alex',
];
const LAST_INITIALS = 'ABCDEFGHJKLMNPRSTW'.split('');

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** Display name in the same "First L." format the site header already uses (e.g. "David M."). */
export const randomPersona = () => `${pick(FIRST)} ${pick(LAST_INITIALS)}.`;

export const firstName = (persona: string) => persona.split(' ')[0];

export const GREETING =
  'Hello! I am reviewing live questions right now. Tell me what is happening with your device, or pick an issue below to start directly.';
