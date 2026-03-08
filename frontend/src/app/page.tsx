"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import LoginPage from "@/components/LoginPage";
import Sidebar from "@/components/Sidebar";
import ChatWindow from "@/components/ChatWindow";

export default function Home() {
  const { isAuthenticated, isLoading } = useAuth();
  const [selectedConv, setSelectedConv] = useState<number | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#e5ddd5] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#075e54] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const handleSelectConv = (id: number) => {
    setSelectedConv(id);
    // On mobile: hide sidebar when a conversation is selected
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setShowSidebar(false);
    }
  };

  const toggleSidebar = () => {
    setShowSidebar((prev) => !prev);
  };

  const handleBack = () => {
    setSelectedConv(null);
    setShowSidebar(true);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-[#111b21]">
      {/* Sidebar */}
      <div
        className={`
          ${showSidebar ? "w-full md:w-80 lg:w-96 border-r" : "w-0 border-r-0"}
          ${!showSidebar && "md:w-0"}
          transition-all duration-300 ease-in-out
          flex-shrink-0
          border-[#3b4a54]
          z-20
          overflow-hidden
          relative
        `}
      >
        <div className="w-full md:w-80 lg:w-96 h-full">
          <Sidebar
            selectedId={selectedConv}
            onSelect={handleSelectConv}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>

      {/* Chat area */}
      <div
        className={`
          ${!showSidebar || selectedConv ? "flex" : "hidden"}
          md:flex
          flex-1 flex-col
          overflow-hidden
          relative
        `}
      >
        <ChatWindow
          conversationId={selectedConv}
          isSidebarOpen={showSidebar}
          onToggleSidebar={toggleSidebar}
          onBack={handleBack}
          onNewMessage={() => setRefreshTrigger((n) => n + 1)}
        />
      </div>
    </div>
  );
}
