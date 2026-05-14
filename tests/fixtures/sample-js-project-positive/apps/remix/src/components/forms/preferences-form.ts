
type ParticipantRole = 'EDITOR' | 'VIEWER' | 'COMMENTER';
type ParticipantEntry = { email: string; name?: string; role: ParticipantRole };

declare function useState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>];

const [participants, setParticipants] = useState<ParticipantEntry[]>([]);

function updateParticipantRole(index: number, newRole: ParticipantRole) {
  setParticipants((prev) =>
    prev.map((participant, idx) =>
      idx === index ? { ...participant, role: newRole } : participant,
    ),
  );
}

function removeParticipant(index: number) {
  setParticipants((prev) => prev.filter((_, idx) => idx !== index));
}

function addParticipant(entry: ParticipantEntry) {
  setParticipants((prev) => [...prev, entry]);
}
