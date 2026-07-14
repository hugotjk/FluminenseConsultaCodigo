import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs, 
  deleteDoc,
  writeBatch
} from "firebase/firestore/lite";
import { GroupedProduct } from "../types";

const firebaseConfig = {
  apiKey: "AIzaSyCmUO7RKJ1dkzTFknyujb1Ydzam9oDIuxM",
  authDomain: "poised-grin-8tgzl.firebaseapp.com",
  projectId: "poised-grin-8tgzl",
  storageBucket: "poised-grin-8tgzl.firebasestorage.app",
  messagingSenderId: "151986359434",
  appId: "1:151986359434:web:c658d1531e2c2dfe2bf173"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// Use the custom database ID from config
export const db = getFirestore(app, "ai-studio-consultadeprodut-8cd1dea3-295c-4716-a21f-84fd38e366b7");

export interface FirestoreSyncInfo {
  lastUpdated: string | null;
  totalCount: number;
  fileName: string | null;
  fileId: string | null;
}

const CHUNK_SIZE = 500;

/**
 * Saves products to Firestore in chunks of CHUNK_SIZE
 */
export async function saveProductsToFirestore(
  products: GroupedProduct[],
  syncInfo: FirestoreSyncInfo
): Promise<void> {
  try {
    console.log(`Saving ${products.length} products to Firestore in chunks...`);
    
    // Save metadata
    const metadataRef = doc(db, "metadata", "sync_info");
    await setDoc(metadataRef, syncInfo);
    
    // Split products into chunks
    const chunks: GroupedProduct[][] = [];
    for (let i = 0; i < products.length; i += CHUNK_SIZE) {
      chunks.push(products.slice(i, i + CHUNK_SIZE));
    }
    
    // To ensure old extra chunks are removed, we first get all existing chunks from Firestore
    const chunksColRef = collection(db, "product_chunks");
    const querySnapshot = await getDocs(chunksColRef);
    const existingChunkIds = querySnapshot.docs.map(doc => doc.id);
    
    // Save new chunks
    const activeChunkIds = new Set<string>();
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkId = `chunk_${idx}`;
      activeChunkIds.add(chunkId);
      
      const chunkRef = doc(db, "product_chunks", chunkId);
      await setDoc(chunkRef, {
        index: idx,
        products: chunks[idx]
      });
    }
    
    // Delete any old chunks that are no longer active
    for (const id of existingChunkIds) {
      if (!activeChunkIds.has(id)) {
        const docRef = doc(db, "product_chunks", id);
        await deleteDoc(docRef);
        console.log(`Deleted obsolete chunk doc: ${id}`);
      }
    }
    
    console.log("Products and metadata successfully saved to Firestore!");
  } catch (err) {
    console.error("Error saving to Firestore:", err);
    throw err;
  }
}

/**
 * Loads products and metadata from Firestore
 */
export async function loadProductsFromFirestore(): Promise<{
  products: GroupedProduct[];
  lastUpdated: string | null;
  fileName: string | null;
  totalCount: number;
} | null> {
  try {
    console.log("Loading products from Firestore...");
    
    // 1. Load sync metadata
    const metadataRef = doc(db, "metadata", "sync_info");
    const metadataSnap = await getDoc(metadataRef);
    if (!metadataSnap.exists()) {
      console.log("No metadata doc found in Firestore");
      return null;
    }
    
    const meta = metadataSnap.data() as FirestoreSyncInfo;
    
    // 2. Load all chunks
    const chunksColRef = collection(db, "product_chunks");
    const querySnapshot = await getDocs(chunksColRef);
    
    if (querySnapshot.empty) {
      console.log("No chunks found in product_chunks collection");
      return null;
    }
    
    // Sort chunks by index to maintain correct ordering if needed
    const sortedDocs = [...querySnapshot.docs].sort((a, b) => {
      const idxA = a.data().index || 0;
      const idxB = b.data().index || 0;
      return idxA - idxB;
    });
    
    // Combine products
    let allProducts: GroupedProduct[] = [];
    for (const docSnap of sortedDocs) {
      const productsChunk = docSnap.data().products as GroupedProduct[];
      if (Array.isArray(productsChunk)) {
        allProducts = allProducts.concat(productsChunk);
      }
    }
    
    console.log(`Successfully loaded ${allProducts.length} products from Firestore chunks!`);
    
    return {
      products: allProducts,
      lastUpdated: meta.lastUpdated,
      fileName: meta.fileName,
      totalCount: meta.totalCount || allProducts.length
    };
  } catch (err) {
    console.error("Error loading from Firestore:", err);
    return null;
  }
}
