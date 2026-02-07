import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBPKQZh0p7BWtXBJRtfqDCGjNA5eSn6_5s",
  authDomain: "bfl-sim.firebaseapp.com",
  projectId: "bfl-sim",
  storageBucket: "bfl-sim.firebasestorage.app",
  messagingSenderId: "768133719642",
  appId: "1:768133719642:web:881db26870688fd1dcda63",
  measurementId: "G-VV0C2NPF2Z"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
