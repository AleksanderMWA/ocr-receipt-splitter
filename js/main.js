window.onload = async function() {
    try {
        await dbConnectionPromise;
    } 
    
    catch (error) {
        console.log("Unable to initialize the expenses database:", error);
        return;
    }

    //#region Expense cards display

    function displayExpenseCards() {
        const transaction = dbConnection.transaction(
            dbStoreObject,
            "readonly"
        );

        const dbStoreObjectReference =
            transaction.objectStore(dbStoreObject);

        const getAllRequest = dbStoreObjectReference.getAll();

        getAllRequest.onsuccess = () => {
            const expenses = getAllRequest.result;

            const expenseCardContainer =
                document.getElementById("expenseCardContainer");

            expenseCardContainer.innerHTML = "";

            if (expenses.length === 0) {
                const emptyState = document.createElement("p");
                emptyState.classList.add("expense-empty-state");
                emptyState.setAttribute("role", "status");
                emptyState.textContent = "No expenses to display.";
                expenseCardContainer.appendChild(emptyState);
                return;
            }

            for (const expense of expenses) {                
                const expenseCard = document.createElement("div");
                expenseCard.classList.add("expense-card-custom");

                expenseCard.innerHTML = `
                    <p class="expense-card-title">${expense.expenseName}</p>
                    <div class="expense-card-divider"></div>
                    <div class="expense-card-info">
                        <p>Created: ${expense.expenseDateOfCreation}</p>
                        <p>Receipt count: ${expense.expenseReceipts.length}</p>
                    </div>
                `;

                expenseCard.addEventListener("click", () => {
                    sessionStorage.setItem("expenseCurrentlyActive", expense.expenseId)
                    window.location.replace("/pages/expense.html");                                       
                });                

                expenseCardContainer.appendChild(expenseCard);
            }
        };

        getAllRequest.onerror = () => {
            console.error("Error fetching expenses:", getAllRequest.error);
        };
    }

    displayExpenseCards();

    //#endregion



    //#region Add participants in expense creation

    const expenseParticipants = document.getElementById("expenseParticipants");
    const addButton = document.getElementById("expenseAddParticipantButton");

    function addInput() {
        const input = document.createElement("input");

        input.type = "text";
        input.name = "expenseParticipants";
        input.className = "form-control custom-input mb-2";
        input.placeholder = "Enter participant name";
        input.setAttribute("required", "required");       
        
        input.required = true;

        const participantField = document.createElement("div");
        participantField.className = "participant-field";

        participantField.appendChild(input);

        const invalidFeedback = document.createElement("div");
        invalidFeedback.className = "invalid-feedback";
        invalidFeedback.textContent = "Please enter a participant name.";
        participantField.appendChild(invalidFeedback);

        expenseParticipants.appendChild(participantField);

        input.focus();
    }

    addButton.addEventListener("click", addInput);

    expenseParticipants.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            addInput();
        }
    });

    function validateUniqueParticipants() {
        const participantInputs = expenseParticipants.querySelectorAll(
            'input[name="expenseParticipants"]'
        );
        const participantCounts = new Map();

        for (const input of participantInputs) {
            const participantName = input.value.trim().toLowerCase();
            if (participantName) {
                participantCounts.set(
                    participantName,
                    (participantCounts.get(participantName) || 0) + 1
                );
            }
        }

        for (const input of participantInputs) {
            const participantName = input.value.trim().toLowerCase();
            const isDuplicate =
                participantName &&
                participantCounts.get(participantName) > 1;

            input.setCustomValidity(
                isDuplicate ? "Participant names must be unique." : ""
            );
            input.nextElementSibling.textContent = isDuplicate
                ? "Participant names must be unique."
                : "Please enter a participant name.";
        }

        return Array.from(participantInputs).every((input) =>
            input.validity.valid
        );
    }

    expenseParticipants.addEventListener("input", validateUniqueParticipants);

    //#endregion


    //#region Save new expense in IndexedDB store object 

    const expenseCreateButton = document.getElementById("expenseCreateButton");

    expenseCreateButton.addEventListener("click", function (event) {
        event.preventDefault();

        const form = document.getElementById("expenseCreationForm");
        
        form.classList.add("was-validated");
        
        const participantsAreUnique = validateUniqueParticipants();

        if (!participantsAreUnique || !form.checkValidity()) {
            console.log("Form is invalid.");
            return;
        }

        const formData = new FormData(form);

        const newExpense = {
            expenseName: formData.get("expenseName"),
            expenseDateOfCreation: (new Date()).toLocaleDateString("en-GB"),
            expenseParticipants: formData.getAll("expenseParticipants")
                .map((participant) => participant.trim()),
            expenseReceipts: []        
        };    
        
        if (!dbConnection) {
            console.error("Database is not ready yet!");
            return;
        }

        const transaction = dbConnection.transaction(dbStoreObject, "readwrite");

        const dbStoreObjectReference = transaction.objectStore(dbStoreObject);
        const dbAddRequest = dbStoreObjectReference.add(newExpense);

        dbAddRequest.onsuccess = () => {
            const expenseId = dbAddRequest.result;

            console.log("Expense added successfully!");
            console.log(newExpense);
            console.log("Expense ID:", expenseId);
            sessionStorage.setItem("expenseCurrentlyActive", expenseId)
            window.location.replace("/pages/expense.html");
        };

        dbAddRequest.onerror = () => {
            console.error("Saving failed:", dbAddRequest.error);
        };

        transaction.oncomplete = () => {
            console.log("Transaction completed successfully!");
        };

        transaction.onerror = () => {
            console.error("Transaction failed:", transaction.error);
        };

    });

    //#endregion



    
}