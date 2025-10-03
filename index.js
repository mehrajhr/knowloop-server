const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const app = express();
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64");
const serviceAccount = JSON.parse(decoded.toString("utf8"));
const port = process.env.PORT || 5000;
const { MongoClient, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// DB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.a0ni9sf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);

async function run() {
  try {
    // await client.connect();

    const db = client.db("knowloop");
    const usersCollection = db.collection("users");
    const sessionsCollection = db.collection("studySessions");
    const bookedSessionsCollection = db.collection("bookedSessions");
    const notesCollection = db.collection("notes");
    const materialsCollection = db.collection("materials");
    const transactionsCollection = db.collection("transaction");

    // verify

    const verifyFBToken = async (req, res, next) => {
      // console.log('from middleware ', req.headers.authorization);
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      // verify the token

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyTutor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "tutor") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyEmail = async (req, res, next) => {
      if (req.decoded.email !== req.query.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // for useres

    // get user
    app.get("/users/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (req.decoded.email !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // update user profile (name, photo)
    app.put("/users-update/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== req.params.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const { name, photo } = req.body;

      const filter = { email };
      const updateDoc = {
        $set: { name, photo },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // get all tutor
    // GET /users/role/tutor
    app.get("/users/role/tutor", async (req, res) => {
      try {
        const tutors = await usersCollection.find({ role: "tutor" }).toArray();
        res.send(tutors);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch tutors" });
      }
    });

    app.get("/admin/users", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const search = req.query.search || "";
        const query = {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        };

        const users = await usersCollection.find(query).toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    app.patch(
      "/admin/users/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { role } = req.body;

          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );

          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Failed to update role" });
        }
      }
    );

    // create user
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        const email = user.email;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          await usersCollection.updateOne(
            { email },
            { $set: { last_login: new Date().toISOString } }
          );
          return res
            .status(200)
            .json({ message: "User already exists", updated: true });
        }

        const result = await usersCollection.insertOne(user);
        return res
          .status(201)
          .json({ message: "New user created", insertedId: result.insertedId });
      } catch (error) {
        console.error("Error saving user:", error);
        return res.status(500).json({ message: "Server error" });
      }
    });

    // get user role
    app.get("/role/users", verifyFBToken, verifyEmail, async (req, res) => {
      const email = req.query.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.send({ role: user.role });
    });

    // payment related apis

    // GET: /transactions?email=student@example.com
    app.get("/transactions", verifyFBToken, verifyEmail, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Missing student email" });
      }

      try {
        const transactions = await transactionsCollection
          .find({ studentEmail: email })
          .sort({ date: -1 }) // latest first
          .toArray();
        res.send(transactions);
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    app.post("/create-payment-intent", verifyFBToken, async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // amount in cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/transactions", verifyFBToken, async (req, res) => {
      try {
        const transaction = req.body;

        const result = await transactionsCollection.insertOne(transaction);
        res.send({
          success: result.insertedId ? true : false,
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/sessions/payment/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const { payment_status, studentEmail } = req.body;

      try {
        const result = await bookedSessionsCollection.updateOne(
          { sessionId: id, studentEmail },
          {
            $set: {
              paymentStatus: payment_status || "paid",
            },
          }
        );

        res.send({ success: result.modifiedCount > 0 });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // for sessions

    // get all sessions
    app.get("/sessions", async (req, res) => {
      const { status, email } = req.query;
      const query = {};

      if (email) {
        query.tutor_email = email;
      }
      if (status && status !== "all") {
        query.status = status;
      } else if (!status) {
        query.status = "approved";
      }

      try {
        let sessions;
        if (status === "all") {
          sessions = await sessionsCollection
            .find(query)
            .sort({ registrationStartDate: 1 })
            .toArray();
        } else {
          sessions = await sessionsCollection
            .find(query)
            .sort({ registrationStartDate: 1 })
            .toArray();
        }

        res.send(sessions);
      } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ message: "Failed to fetch study sessions" });
      }
    });

    // get session by id for details
    app.get("/sessions/:id", async (req, res) => {
      try {
        const sessionId = req.params.id;

        // Validate ObjectId
        if (!ObjectId.isValid(sessionId)) {
          return res.status(400).json({ message: "Invalid session ID" });
        }

        const session = await sessionsCollection.findOne({
          _id: new ObjectId(sessionId),
        });

        if (!session) {
          return res.status(404).json({ message: "Study session not found" });
        }

        res.send(session);
      } catch (error) {
        console.error("Error fetching session by ID:", error);
        res.status(500).json({ message: "Failed to fetch session" });
      }
    });

    // for teacher

    // post or create session by teacher
    app.post(
      "/study-sessions",
      verifyFBToken,
      verifyTutor,
      async (req, res) => {
        try {
          const session = req.body;

          // Ensure fee and status have default values
          session.fee = session.fee || "0";
          session.status = "pending";
          session.reviews = [];
          session.averageRating = 0;

          const result = await sessionsCollection.insertOne(session);
          res.send({ success: true, insertedId: result.insertedId });
        } catch (error) {
          console.error("Error creating session:", error);
          res
            .status(500)
            .send({ success: false, message: "Failed to create session" });
        }
      }
    );

    // resend request rejected sessions to admin for approved
    app.patch(
      "/sessions/resend/:id",
      verifyFBToken,
      verifyTutor,
      async (req, res) => {
        try {
          const { id } = req.params;
          const result = await sessionsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "pending" } }
          );

          if (result.modifiedCount > 0) {
            res
              .status(200)
              .json({ message: "Approval request resent successfully." });
          } else {
            res
              .status(404)
              .json({ message: "Session not found or already pending." });
          }
        } catch (error) {
          console.error("Error resending approval:", error);
          res
            .status(500)
            .json({ message: "Failed to resend approval request" });
        }
      }
    );

    // use by admin for sessions

    // sessions delete by admin
    app.delete(
      "/sessions/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await sessionsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // update price by admin
    app.patch("/sessions/:id", async (req, res) => {
      const id = req.params.id;
      const { price } = req.body;

      try {
        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { fee: price } }
        );

        res.send(result);
      } catch (error) {
        console.error("Failed to update session price:", error);
        res.status(500).json({ message: "Update failed" });
      }
    });

    // set fees by admin
    app.patch(
      "/sessions/approve/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { fee, status } = req.body;
        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { fee, status } }
        );
        res.send({ success: result.modifiedCount > 0 });
      }
    );

    // Reject session by admin with reason and feedback
    app.patch(
      "/sessions/reject/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { reason, feedback } = req.body;

        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "rejected",
              rejectionReason: reason,
              rejectionFeedback: feedback,
            },
          }
        );

        res.send({ success: result.modifiedCount > 0 });
      }
    );

    // for materials

    // for students
    app.get(
      "/student/materials",
      verifyFBToken,
      verifyEmail,
      async (req, res) => {
        try {
          const { email } = req.query;

          // Step 1: Get all booked sessions for the student
          const bookedSessions = await bookedSessionsCollection
            .find({ studentEmail: email })
            .toArray();

          const validSessionIds = [];

          // Step 2: Check each session's payment status and actual session fee
          for (const booking of bookedSessions) {
            const session = await sessionsCollection.findOne({
              _id: new ObjectId(booking.sessionId),
            });

            if (session) {
              const isFree = session.fee === "Free";
              const isPaidAndPaymentDone =
                session.fee !== "Free" && booking.paymentStatus === "paid";

              if (isFree || isPaidAndPaymentDone) {
                validSessionIds.push(booking.sessionId);
              }
            }
          }

          // Step 3: Get materials for valid sessions
          const materials = await materialsCollection
            .find({ sessionId: { $in: validSessionIds } })
            .sort({ createdAt: -1 })
            .toArray();

          res.send(materials);
        } catch (error) {
          console.error("Error fetching materials:", error);
          res.status(500).send({ message: "Failed to load materials" });
        }
      }
    );

    app.get("/materials", verifyFBToken, verifyTutor, async (req, res) => {
      const { email } = req.query;
      try {
        const query = { tutorEmail: email };
        const materials = await materialsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(materials);
      } catch (error) {
        console.error("Error fetching materials:", error);
        res.status(500).json({ message: "Failed to fetch materials" });
      }
    });

    app.post("/materials", verifyFBToken, verifyTutor, async (req, res) => {
      try {
        const material = req.body;
        const result = await materialsCollection.insertOne(material);
        res.send(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to upload material" });
      }
    });

    // delete materilas
    app.delete(
      "/materials/:id",
      verifyFBToken,
      verifyTutor,
      async (req, res) => {
        const id = req.params.id;
        try {
          const result = await materialsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.send(result);
        } catch (error) {
          console.error("Error deleting material:", error);
          res.status(500).json({ message: "Failed to delete material" });
        }
      }
    );

    // update materials
    app.patch(
      "/materials/:id",
      verifyFBToken,
      verifyTutor,
      async (req, res) => {
        const id = req.params.id;
        const { title, link } = req.body;
        try {
          const result = await materialsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { title, link } }
          );
          res.send(result);
        } catch (error) {
          console.error("Error updating material:", error);
          res.status(500).json({ message: "Failed to update material" });
        }
      }
    );

    // for admin materials
    app.get(
      "/admin/materials",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const materials = await materialsCollection
            .find()
            .sort({ uploadedAt: -1 })
            .toArray();
          res.send(materials);
        } catch (error) {
          res.status(500).send({ message: "Failed to fetch materials" });
        }
      }
    );

    app.delete(
      "/admin/materials/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await materialsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Failed to delete material" });
        }
      }
    );

    // for booked sessions which use user

    // create booked session
    app.post("/booked-sessions", verifyFBToken, async (req, res) => {
      try {
        const bookedData = req.body;

        const result = await bookedSessionsCollection.insertOne(bookedData);
        res.send({ success: true, result });
      } catch (error) {
        console.error("Error booking session:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to book session" });
      }
    });

    // get users booked session via email
    app.get("/booked-sessions/user/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (email !== req.decoded.email) {
          res.send(403).status({ message: "forbidden access" });
        }
        const query = { studentEmail: email };
        const result = await bookedSessionsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching user booked sessions:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // check the user booked in specific session
    app.get(
      "/booked-sessions/check",
      verifyFBToken,
      verifyEmail,
      async (req, res) => {
        try {
          const { email, sessionId } = req.query;

          if (!email || !sessionId) {
            return res
              .status(400)
              .json({ message: "Missing email or session ID" });
          }

          const alreadyBooked = await bookedSessionsCollection.findOne({
            sessionId,
            studentEmail: email,
          });

          res.send({ booked: !!alreadyBooked, ...alreadyBooked });
        } catch (error) {
          console.error("Booking check failed:", error);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // if the user cancel booking then delete the data from this
    app.delete(
      "/booked-sessions",
      verifyFBToken,
      verifyEmail,
      async (req, res) => {
        try {
          const { email, sessionId } = req.query;

          if (!email || !sessionId) {
            return res
              .status(400)
              .json({ message: "Missing email or session ID" });
          }

          const result = await bookedSessionsCollection.deleteOne({
            sessionId,
            studentEmail: email,
          });

          if (result.deletedCount > 0) {
            res.send({ success: true, message: "Booking canceled" });
          } else {
            res.send({
              success: false,
              message: "No unpaid booking found to cancel",
            });
          }
        } catch (error) {
          console.error("Error canceling booking:", error);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // ✅ POST /sessions/review/:id (Add review & update rating)

    app.post("/sessions/review/:id", verifyFBToken, async (req, res) => {
      const sessionId = req.params.id;
      const { studentName, reviewText, rating } = req.body;

      try {
        const session = await sessionsCollection.findOne({
          _id: new ObjectId(sessionId),
        });

        if (!session) {
          return res
            .status(404)
            .json({ success: false, message: "Session not found" });
        }

        // Append the new review
        const updatedReviews = [
          ...(session.reviews || []),
          { studentName, reviewText, rating },
        ];

        // Calculate new average rating
        const totalRating = updatedReviews.reduce(
          (sum, r) => sum + parseFloat(r.rating),
          0
        );
        const averageRating = parseFloat(
          (totalRating / updatedReviews.length).toFixed(1)
        );

        // Update in DB
        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(sessionId) },
          {
            $set: {
              reviews: updatedReviews,
              averageRating: averageRating,
            },
          }
        );

        res.json({
          success: true,
          message: "Review submitted",
          updated: result.modifiedCount > 0,
        });
      } catch (error) {
        console.error("Error submitting review:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    // for the notes

    // get users notes

    app.get("/notes/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) return res.status(400).send({ error: "Email is required" });
        if (email !== req.decoded.email) {
          res.send(403).status({ message: "forbidden access" });
        }

        const notes = await notesCollection.find({ email }).toArray();
        res.send(notes);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch notes" });
      }
    });

    // for update notes
    app.patch("/notes/:id", async (req, res) => {
      const { id } = req.params;
      const updatedNote = req.body;

      try {
        const result = await notesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedNote }
        );

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "Note updated successfully" });
        } else {
          res.send({
            success: false,
            message: "No changes made or note not found",
          });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Update failed", error });
      }
    });

    // for delete notes

    app.delete("/notes/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await notesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: result.deletedCount > 0 });
      } catch (err) {
        res.status(500).send({ error: "Failed to delete note" });
      }
    });

    // create the students notes
    app.post("/notes", async (req, res) => {
      try {
        const { email, title, description } = req.body;
        if (!email || !title || !description) {
          return res
            .status(400)
            .send({ success: false, message: "All fields required" });
        }

        const result = await notesCollection.insertOne({
          email,
          title,
          description,
          createdAt: new Date().toISOString(),
        });

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } catch (error) {
    console.error(error);
  }
}
run();

app.get("/", async (req, res) => {
  res.send("know loop server running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
