import { collection, addDoc, getDocs, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

const TEAMS_COLLECTION = "teams";
const MATCHES_COLLECTION = "matches";

export const getTeams = async () => {
    const querySnapshot = await getDocs(collection(db, TEAMS_COLLECTION));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const subscribeToTeams = (callback) => {
    const q = query(collection(db, TEAMS_COLLECTION));
    return onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(data);
    });
}

export const addMatch = async (matchData) => {
    try {
        const docRef = await addDoc(collection(db, MATCHES_COLLECTION), matchData);
        return docRef.id;
    } catch (e) {
        console.error("Error adding match: ", e);
        throw e;
    }
};

export const subscribeToMatches = (callback) => {
    const q = query(collection(db, MATCHES_COLLECTION), orderBy("date"));
    return onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(data);
    });
};
