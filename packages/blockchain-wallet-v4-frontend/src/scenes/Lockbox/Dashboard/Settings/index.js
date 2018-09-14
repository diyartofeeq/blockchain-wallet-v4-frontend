import React from 'react'
import styled from 'styled-components'
import RenameDevice from './RenameDevice'
import RemoveDevice from './RemoveDevice'
import ExportXPub from './ExportXPub'
import AddDevice from './AddDevice'
import RestoreDevice from './RestoreDevice'
import UpdateDevice from './UpdateDevice'

const SettingsContainer = styled.div`
  padding: 0px 15px;
`

export default class LockboxSettings extends React.PureComponent {
  render () {
    const { device } = this.props

    return (
      <SettingsContainer>
        <RenameDevice deviceId={device.device_id} />
        <UpdateDevice deviceId={device.device_id} />
        <AddDevice />
        <RestoreDevice />
        <ExportXPub deviceId={device.device_id} />
        <RemoveDevice deviceId={device.device_id} />
      </SettingsContainer>
    )
  }
}
