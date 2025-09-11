import React from 'react'
import img1 from '../../assets/images/logo.webp'
import { Typography, Chip } from '@mui/material'

function Header() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 20px",
      }}
    >
      {/* Logo */}
      <img
        src={img1}
        alt="Logo"
        style={{ width: "350px", height: "80px", objectFit: "contain" }}
      />

      {/* Center Title */}
      <Typography variant="h4" fontWeight="bold" color="primary">
        APR Reports
      </Typography>

      {/* Right Label */}
      <Chip
        label={
          <span>
            <strong>Tenant:</strong> dsouth
          </span>
        }
        color="primary"
        variant="outlined"
        sx={{
          fontSize: "0.9rem",
          fontWeight: "600",
          px: 1.5,
          py: 0.5,
          borderRadius: "8px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          bgcolor: "#f4f6f8",
        }}
      />
    </div>
  )
}

export default Header
