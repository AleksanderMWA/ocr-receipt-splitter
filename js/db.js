const dbVersion = 1; // there is no reason to create db with newer version, or try to upgrade it in the future
const dbName = "ExpensesDB";    
const dbStoreObject = "expenses";
let dbConnection;

const dbConnectionPromise = new Promise((resolve, reject) => {
    const dbRequest = indexedDB.open(dbName, dbVersion);

    dbRequest.onupgradeneeded = (event) => {
        const database = event.target.result;

        database.createObjectStore(dbStoreObject, {
            keyPath: "expenseId",
            autoIncrement: true
        });
    };

    dbRequest.onsuccess = () => {
        dbConnection = dbRequest.result;
        console.log("Database opened successfully!");
        resolve(dbConnection);
    };

    dbRequest.onerror = () => {
        console.log("Error opening database:", dbRequest.error);
        reject(dbRequest.error);
    };
});