# FlowSync — Collaborative Project Management Platform

FlowSync is a full-stack project management platform designed to help teams organize projects, manage tasks, collaborate with teammates, and track their work in one place. It provides a centralized workspace where users can coordinate activities, share project resources, and monitor progress.

## 🚀 Features

- **User Authentication:** Secure registration and login with password hashing and token-based authentication.
- **Workspace Management:** Organize team members and projects within shared workspaces.
- **Project Management:** Create and manage projects to organize team activities.
- **Task Management:** Create, update, assign, and track tasks throughout their lifecycle.
- **Team Collaboration:** Support collaboration through task comments and shared project information.
- **File Management:** Upload and access files associated with projects and tasks.
- **Search Functionality:** Search for relevant projects, tasks, comments, files, and team members.
- **User Profiles:** View and update profile information and professional details.
- **Task Progress Tracking:** Monitor task statuses and keep project activities organized.
- **Responsive User Interface:** A modern React-based interface for navigating and managing project activities.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| React | Builds the interactive user interface |
| Vite | Frontend development server and build tool |
| Tailwind CSS | Styling and responsive layouts |
| React Router | Navigation between application pages |
| Redux Toolkit | Application state management |
| Axios | Communication between frontend and backend |
| Node.js | JavaScript runtime for the backend |
| Express.js | Backend API and request handling |
| MongoDB | Stores application data |
| Mongoose | MongoDB object modeling |
| JWT | Token-based authentication |
| bcrypt | Password hashing |
| Multer | File upload handling |
| Nodemailer | Email-related functionality |

## 🏗️ System Architecture

FlowSync follows a client-server architecture.

```text
             USER
               |
               v
      React Frontend
       (Vite + CSS)
               |
               | HTTP / REST API
               v
      Node.js + Express
       Backend Server
               |
       +-------+--------+
       |                |
       v                v
   MongoDB         Authentication
   Database        (JWT + bcrypt)
       |
       v
 Projects, Tasks,
 Users, Comments
 and Related Data
```

### How It Works

1. Users interact with the application through the React frontend.
2. The frontend sends HTTP requests to the Express backend using Axios.
3. The backend validates requests and checks authentication where required.
4. Mongoose communicates with MongoDB to retrieve or update data.
5. The backend returns responses to the frontend.
6. React updates the interface to reflect the results.

## 📂 Project Structure

```text
FlowSync/
├── client/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── features/
│   │   ├── services/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── server/
│   ├── src/
│   │   ├── controllers/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── middleware/
│   │   └── server.js
│   ├── package.json
│   └── .env
│
├── tools/
└── README.md
```

*Note: The directory tree above illustrates the intended organization of the application. Actual filenames and folders may differ slightly in the repository.*

## ⚙️ Installation and Setup

### Prerequisites

Install the following before running the application:

- [Node.js](https://nodejs.org/)
- npm (included with Node.js)
- [MongoDB Atlas](https://www.mongodb.com/atlas) or a local MongoDB installation
- [Git](https://git-scm.com/)
- [Visual Studio Code](https://code.visualstudio.com/)

### 1. Clone the Repository

```bash
git clone https://github.com/R-Supritha/FlowSync.git
cd FlowSync
```

### 2. Configure the Backend

Open a terminal in the project root and run:

```bash
cd server
npm install
```

Create a `.env` file inside the `server` directory.

Add the following environment variables, replacing the example values with your own configuration:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_long_random_secret
```

**Important:** Use the exact environment variable names expected by the backend source code. Never commit your actual `.env` file or database credentials to GitHub.

### 3. Configure MongoDB

1. Sign in to MongoDB Atlas or start your local MongoDB server.
2. Create or select a database.
3. Configure database access credentials if you use Atlas.
4. Add your connection string to `MONGO_URI` in `server/.env`.
5. Ensure your database network access settings permit the connection.
6. Restart the backend after saving the configuration.

### 4. Start the Backend Server

From the `server` directory, run:

```bash
npm run dev
```

The backend starts using the development script defined in `server/package.json`.

If port 5000 is configured, the local server address will typically be:

```text
http://localhost:5000
```

### 5. Start the Frontend

Open a **second terminal** in Visual Studio Code.

```bash
cd client
npm install
npm run dev
```

Vite will display a local development URL in the terminal, typically:

```text
http://localhost:5173
```

Open the displayed URL in your browser.

## 🔐 Security

FlowSync incorporates backend security mechanisms and authentication-related dependencies, including:

- Password hashing using bcrypt.
- JWT-based authentication.
- Request validation and authentication middleware.
- Environment variables for sensitive configuration.
- HTTP security headers through Helmet.
- Rate limiting for supported endpoints.

Security controls should be configured and verified before production deployment.

## 🧪 Testing

The application can be tested by checking the following workflows:

1. User registration and login.
2. Access to protected routes.
3. Workspace and project management.
4. Task creation and status updates.
5. Comments and team collaboration.
6. File uploads and retrieval.
7. Search results.
8. Profile updates.
9. MongoDB connectivity and error handling.

## 🎯 Project Objectives

- Simplify project and task organization.
- Improve collaboration among team members.
- Centralize project-related resources and information.
- Provide a structured way to track tasks and progress.
- Demonstrate full-stack web development using the MERN ecosystem.

## 🔮 Future Enhancements

- Real-time task and notification updates.
- Advanced project analytics and visual reports.
- Calendar integration and deadline reminders.
- Role-based permissions with configurable access levels.
- Improved mobile experience.
- Automated testing and continuous integration.
- Production deployment with monitoring.

## 👩‍💻 Contributors

FlowSync is developed collaboratively as a team project.

- **Repository:** [R-Supritha/FlowSync](https://github.com/R-Supritha/FlowSync)

## 📄 License

No open-source license has been specified here. Add a license file if the project is intended to be distributed or reused under a particular license.
